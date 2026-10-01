import { and, eq, notInArray, sql } from "drizzle-orm";
import {
  concepts,
  entries,
  entrySentences,
  packConcepts,
  packs,
  sentences,
} from "../db/schema.js";
import type { Db } from "../db/types.js";
import type { PackFile } from "./pack-file.js";

export interface ImportSummary {
  slug: string;
  concepts: number;
  conceptsCreated: number;
  entries: number;
  sentences: number;
}

// Makes the database match the pack file. Safe to run repeatedly: concepts are
// matched by gloss, entries by (concept, language, lemma) and sentences by
// (language, text). Entries and sentence links that are no longer in the file
// are removed, so correcting a lemma in the file corrects the card. User cards
// point at concepts, not entries, so they are unaffected. The whole pack is one
// transaction.
export async function importPack(db: Db, pack: PackFile): Promise<ImportSummary> {
  return db.transaction(async (tx) => {
    const summary: ImportSummary = {
      slug: pack.slug,
      concepts: pack.concepts.length,
      conceptsCreated: 0,
      entries: 0,
      sentences: 0,
    };

    const [packRow] = await tx
      .insert(packs)
      .values({ slug: pack.slug, name: pack.name, description: pack.description ?? null })
      .onConflictDoUpdate({
        target: packs.slug,
        set: { name: pack.name, description: pack.description ?? null },
      })
      .returning({ id: packs.id });
    if (!packRow) throw new Error(`could not upsert pack ${pack.slug}`);
    await tx.delete(packConcepts).where(eq(packConcepts.packId, packRow.id));

    for (const [position, concept] of pack.concepts.entries()) {
      const existing = await tx
        .select({ id: concepts.id })
        .from(concepts)
        .where(eq(concepts.gloss, concept.gloss));
      if (existing.length > 1) {
        throw new Error(`gloss "${concept.gloss}" matches ${existing.length} concepts; fix by hand`);
      }
      let conceptId = existing[0]?.id;
      if (!conceptId) {
        const [created] = await tx
          .insert(concepts)
          .values({ gloss: concept.gloss })
          .returning({ id: concepts.id });
        if (!created) throw new Error(`could not create concept "${concept.gloss}"`);
        conceptId = created.id;
        summary.conceptsCreated++;
      }
      await tx.insert(packConcepts).values({ packId: packRow.id, conceptId, position });

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
              (await tx.insert(sentences).values({ language, text }).returning({ id: sentences.id }))[0]?.id;
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

    // Sentences that no entry uses any more.
    await tx.delete(sentences).where(
      sql`not exists (select 1 from ${entrySentences} where ${entrySentences.sentenceId} = ${sentences.id})`,
    );
    return summary;
  });
}
