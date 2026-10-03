import { eq, inArray, notInArray, sql } from "drizzle-orm";
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

// Rows per statement. Postgres allows 65,535 parameters in one statement, and
// the widest insert here has about six columns.
const CHUNK = 1000;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Makes the database match the content files, all in one transaction.
//
// Concepts are matched by key, entries by (concept, language, lemma) and
// sentences by (language, text). Entries and sentence links that are no longer
// in the files are removed, so correcting a lemma in a file corrects the card.
// Packs are rewritten to exactly the listed concepts, in order. Concepts and
// packs that the files no longer mention are reported, not deleted. User cards
// point at concepts, not entries or packs, so they are unaffected. Safe to run
// repeatedly.
//
// The work is batched (a handful of statements per thousand rows rather than
// per concept), because a full library is thousands of concepts.
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

    const idByKey = await upsertConcepts(tx, content.concepts, summary);
    await syncEntries(tx, content.concepts, idByKey, summary);

    for (const pack of content.packs) {
      const [row] = await tx
        .insert(packs)
        .values({
          slug: pack.slug,
          name: pack.name,
          description: pack.description ?? null,
          category: pack.category,
        })
        .onConflictDoUpdate({
          target: packs.slug,
          set: { name: pack.name, description: pack.description ?? null, category: pack.category },
        })
        .returning({ id: packs.id });
      if (!row) throw new Error(`could not upsert pack ${pack.slug}`);
      await tx.delete(packConcepts).where(eq(packConcepts.packId, row.id));
      const members = pack.concepts.map((key, position) => {
        const conceptId = idByKey.get(key);
        if (!conceptId) throw new Error(`pack ${pack.slug} lists unknown concept "${key}"`);
        return { packId: row.id, conceptId, position };
      });
      for (const part of chunks(members)) await tx.insert(packConcepts).values(part);
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

// Finds or creates every concept and returns key -> id.
async function upsertConcepts(
  tx: Tx,
  wanted: Concept[],
  summary: ImportSummary,
): Promise<Map<string, string>> {
  const rows = await tx.select({ id: concepts.id, key: concepts.key, gloss: concepts.gloss }).from(concepts);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  // A concept from before keys existed is adopted by gloss rather than
  // duplicated, so cards already pointing at it keep working.
  const legacyByGloss = new Map<string, { id: string }[]>();
  for (const r of rows) {
    if (r.key.startsWith("legacy:")) {
      legacyByGloss.set(r.gloss, [...(legacyByGloss.get(r.gloss) ?? []), r]);
    }
  }

  const idByKey = new Map<string, string>();
  const toCreate: Concept[] = [];
  for (const concept of wanted) {
    const existing = byKey.get(concept.key);
    if (existing) {
      if (existing.gloss !== concept.gloss) {
        await tx.update(concepts).set({ gloss: concept.gloss }).where(eq(concepts.id, existing.id));
      }
      idByKey.set(concept.key, existing.id);
      continue;
    }
    const legacy = legacyByGloss.get(concept.gloss) ?? [];
    if (legacy.length > 1) {
      throw new Error(`gloss "${concept.gloss}" matches ${legacy.length} unkeyed concepts; fix by hand`);
    }
    const adopted = legacy[0];
    if (adopted) {
      await tx.update(concepts).set({ key: concept.key }).where(eq(concepts.id, adopted.id));
      legacyByGloss.delete(concept.gloss);
      idByKey.set(concept.key, adopted.id);
      summary.conceptsAdopted++;
      continue;
    }
    toCreate.push(concept);
  }

  for (const part of chunks(toCreate)) {
    const created = await tx
      .insert(concepts)
      .values(part.map((c) => ({ key: c.key, gloss: c.gloss })))
      .returning({ id: concepts.id, key: concepts.key });
    for (const row of created) idByKey.set(row.key, row.id);
    summary.conceptsCreated += created.length;
  }
  return idByKey;
}

// Upserts entries and sentences, rewrites the sentence links, and drops entries
// the files no longer list.
async function syncEntries(
  tx: Tx,
  wanted: Concept[],
  idByKey: Map<string, string>,
  summary: ImportSummary,
) {
  type Wanted = {
    conceptId: string;
    language: string;
    lemma: string;
    partOfSpeech: string;
    details: Record<string, unknown>;
    sentences: string[];
  };
  const items: Wanted[] = [];
  for (const concept of wanted) {
    const conceptId = idByKey.get(concept.key)!;
    for (const [language, langEntries] of Object.entries(concept.entries)) {
      for (const e of langEntries) {
        items.push({
          conceptId,
          language,
          lemma: e.lemma,
          partOfSpeech: e.pos,
          details: e.details,
          sentences: e.sentences,
        });
      }
    }
  }
  const entryKey = (conceptId: string, language: string, lemma: string) =>
    `${conceptId}\u0000${language}\u0000${lemma}`;

  // Entries.
  const entryId = new Map<string, string>();
  for (const part of chunks(items, 500)) {
    const rows = await tx
      .insert(entries)
      .values(
        part.map((i) => ({
          conceptId: i.conceptId,
          language: i.language,
          lemma: i.lemma,
          partOfSpeech: i.partOfSpeech,
          details: i.details,
        })),
      )
      .onConflictDoUpdate({
        target: [entries.conceptId, entries.language, entries.lemma],
        set: {
          partOfSpeech: sql`excluded."part_of_speech"`,
          details: sql`excluded."details"`,
        },
      })
      .returning({
        id: entries.id,
        conceptId: entries.conceptId,
        language: entries.language,
        lemma: entries.lemma,
      });
    for (const r of rows) entryId.set(entryKey(r.conceptId, r.language, r.lemma), r.id);
  }
  summary.entries = items.length;

  // Sentences: find the ones that exist, create the rest.
  const sentenceKey = (language: string, text: string) => `${language}\u0000${text}`;
  const sentenceId = new Map<string, string>();
  const distinct = new Map<string, { language: string; text: string }>();
  for (const i of items) {
    for (const text of i.sentences) distinct.set(sentenceKey(i.language, text), { language: i.language, text });
  }
  const texts = [...new Set([...distinct.values()].map((s) => s.text))];
  for (const part of chunks(texts)) {
    const found = await tx
      .select({ id: sentences.id, language: sentences.language, text: sentences.text })
      .from(sentences)
      .where(inArray(sentences.text, part));
    for (const r of found) sentenceId.set(sentenceKey(r.language, r.text), r.id);
  }
  const missing = [...distinct.entries()].filter(([k]) => !sentenceId.has(k)).map(([, s]) => s);
  for (const part of chunks(missing)) {
    const created = await tx
      .insert(sentences)
      .values(part)
      .returning({ id: sentences.id, language: sentences.language, text: sentences.text });
    for (const r of created) sentenceId.set(sentenceKey(r.language, r.text), r.id);
  }

  // Links: rewrite them for every entry we touched.
  const allEntryIds = [...entryId.values()];
  for (const part of chunks(allEntryIds)) {
    await tx.delete(entrySentences).where(inArray(entrySentences.entryId, part));
  }
  const links: { entryId: string; sentenceId: string }[] = [];
  for (const i of items) {
    const eId = entryId.get(entryKey(i.conceptId, i.language, i.lemma))!;
    for (const text of i.sentences) {
      links.push({ entryId: eId, sentenceId: sentenceId.get(sentenceKey(i.language, text))! });
    }
  }
  for (const part of chunks(links)) {
    await tx.insert(entrySentences).values(part).onConflictDoNothing();
  }
  summary.sentences = links.length;

  // Drop entries of these concepts that the files no longer list.
  const keep = new Set(allEntryIds);
  const conceptIds = [...new Set(items.map((i) => i.conceptId))];
  for (const part of chunks(conceptIds)) {
    const have = await tx
      .select({ id: entries.id })
      .from(entries)
      .where(inArray(entries.conceptId, part));
    const stale = have.map((r) => r.id).filter((id) => !keep.has(id));
    for (const staleChunk of chunks(stale)) {
      await tx.delete(entries).where(inArray(entries.id, staleChunk));
    }
  }
}
