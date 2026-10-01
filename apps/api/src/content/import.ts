import { and, eq, like, notInArray, sql } from "drizzle-orm";
import {
  concepts,
  entries,
  entrySentences,
  packConcepts,
  packs,
  sentences,
} from "../db/schema.js";
import type { Db } from "../db/types.js";
import type { Concept, PackFile } from "./content-schema.js";

export interface ImportSummary {
  concepts: number;
  conceptsCreated: number;
  // Concepts that predate keys and were matched by gloss, getting their key.
  conceptsAdopted: number;
  entries: number;
  sentences: number;
  packs: number;
  // Present in the database but not in the files. Never deleted: user cards
  // point at concepts and would cascade away with them.
  conceptsNotInFiles: string[];
  packsNotInFiles: string[];
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Makes the database match the content files, all in one transaction.
//
// Concepts are matched by key, entries by (concept, language, lemma) and
// sentences by (language, text). Entries and sentence links that are no longer
// in the files are removed, so correcting a lemma in a file corrects the card.
// Packs are rewritten to exactly the listed concepts, in order. Concepts and
// packs that the files no longer mention are reported, not deleted. User cards
// point at concepts, not entries or packs, so they are unaffected. Safe to run
// repeatedly.
export async function importContent(
  db: Db,
  content: { concepts: Concept[]; packs: PackFile[] },
): Promise<ImportSummary> {
  return db.transaction(async (tx) => {
    const summary: ImportSummary = {
      concepts: content.concepts.length,
      conceptsCreated: 0,
      conceptsAdopted: 0,
      entries: 0,
      sentences: 0,
      packs: content.packs.length,
      conceptsNotInFiles: [],
      packsNotInFiles: [],
    };

    const idByKey = new Map<string, string>();
    for (const concept of content.concepts) {
      const id = await upsertConcept(tx, concept, summary);
      idByKey.set(concept.key, id);
      await syncEntries(tx, id, concept, summary);
    }

    for (const pack of content.packs) {
      const [row] = await tx
        .insert(packs)
        .values({ slug: pack.slug, name: pack.name, description: pack.description ?? null })
        .onConflictDoUpdate({
          target: packs.slug,
          set: { name: pack.name, description: pack.description ?? null },
        })
        .returning({ id: packs.id });
      if (!row) throw new Error(`could not upsert pack ${pack.slug}`);
      await tx.delete(packConcepts).where(eq(packConcepts.packId, row.id));
      await tx.insert(packConcepts).values(
        pack.concepts.map((key, position) => {
          const conceptId = idByKey.get(key);
          if (!conceptId) throw new Error(`pack ${pack.slug} lists unknown concept "${key}"`);
          return { packId: row.id, conceptId, position };
        }),
      );
    }

    // Sentences that no entry uses any more.
    await tx.delete(sentences).where(
      sql`not exists (select 1 from ${entrySentences} where ${entrySentences.sentenceId} = ${sentences.id})`,
    );

    const keys = content.concepts.map((c) => c.key);
    summary.conceptsNotInFiles = (
      await tx.select({ key: concepts.key }).from(concepts).where(notInArray(concepts.key, keys))
    ).map((r) => r.key);
    const slugs = content.packs.map((p) => p.slug);
    summary.packsNotInFiles = (
      await tx.select({ slug: packs.slug }).from(packs).where(notInArray(packs.slug, slugs))
    ).map((r) => r.slug);
    return summary;
  });
}

async function upsertConcept(tx: Tx, concept: Concept, summary: ImportSummary): Promise<string> {
  const [byKey] = await tx
    .select({ id: concepts.id })
    .from(concepts)
    .where(eq(concepts.key, concept.key));
  if (byKey) {
    await tx.update(concepts).set({ gloss: concept.gloss }).where(eq(concepts.id, byKey.id));
    return byKey.id;
  }

  // A concept from before keys existed: adopt it by gloss rather than create a
  // duplicate, so cards already pointing at it keep working.
  const legacy = await tx
    .select({ id: concepts.id })
    .from(concepts)
    .where(and(eq(concepts.gloss, concept.gloss), like(concepts.key, "legacy:%")));
  if (legacy.length > 1) {
    throw new Error(`gloss "${concept.gloss}" matches ${legacy.length} unkeyed concepts; fix by hand`);
  }
  if (legacy[0]) {
    await tx.update(concepts).set({ key: concept.key }).where(eq(concepts.id, legacy[0].id));
    summary.conceptsAdopted++;
    return legacy[0].id;
  }

  const [created] = await tx
    .insert(concepts)
    .values({ key: concept.key, gloss: concept.gloss })
    .returning({ id: concepts.id });
  if (!created) throw new Error(`could not create concept "${concept.key}"`);
  summary.conceptsCreated++;
  return created.id;
}

async function syncEntries(tx: Tx, conceptId: string, concept: Concept, summary: ImportSummary) {
  for (const [language, langEntries] of Object.entries(concept.entries)) {
    for (const entry of langEntries) {
      const [row] = await tx
        .insert(entries)
        .values({
          conceptId,
          language,
          lemma: entry.lemma,
          partOfSpeech: entry.pos,
          details: entry.details,
        })
        .onConflictDoUpdate({
          target: [entries.conceptId, entries.language, entries.lemma],
          set: { partOfSpeech: entry.pos, details: entry.details },
        })
        .returning({ id: entries.id });
      if (!row) throw new Error(`could not upsert entry ${language} "${entry.lemma}"`);
      summary.entries++;

      await tx.delete(entrySentences).where(eq(entrySentences.entryId, row.id));
      for (const text of entry.sentences) {
        const [found] = await tx
          .select({ id: sentences.id })
          .from(sentences)
          .where(and(eq(sentences.language, language), eq(sentences.text, text)))
          .limit(1);
        const sentenceId =
          found?.id ??
          (await tx.insert(sentences).values({ language, text }).returning({ id: sentences.id }))[0]
            ?.id;
        if (!sentenceId) throw new Error(`could not create sentence "${text}"`);
        await tx
          .insert(entrySentences)
          .values({ entryId: row.id, sentenceId })
          .onConflictDoNothing();
        summary.sentences++;
      }
    }

    // Drop entries for this concept and language that the file no longer lists.
    await tx.delete(entries).where(
      and(
        eq(entries.conceptId, conceptId),
        eq(entries.language, language),
        notInArray(
          entries.lemma,
          langEntries.map((e) => e.lemma),
        ),
      ),
    );
  }
}
