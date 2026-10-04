import { and, asc, eq, exists, inArray, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { EntryView } from "@flashcards/shared";
import { entries, entrySentences, sentences, userCards } from "../db/schema.js";
import type { Db } from "../db/types.js";

// SQL condition: the concept has at least one entry in the given language.
const hasEntry = (db: Db, conceptId: PgColumn, language: string) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(entries)
      .where(and(eq(entries.conceptId, conceptId), eq(entries.language, language))),
  );

// A concept can back a card in a direction only if it has entries in both languages.
export const availableInDirection = (
  db: Db,
  conceptId: PgColumn,
  from: string,
  to: string,
) => and(hasEntry(db, conceptId, from), hasEntry(db, conceptId, to))!;

export async function loadEntries(
  db: Db,
  conceptIds: string[],
  languages: string[],
): Promise<Map<string, EntryView[]>> {
  const byConcept = new Map<string, EntryView[]>();
  if (conceptIds.length === 0) return byConcept;

  const rows = await db
    .select()
    .from(entries)
    .where(
      and(
        inArray(entries.conceptId, conceptIds),
        languages.length > 0 ? inArray(entries.language, languages) : undefined,
      ),
    )
    .orderBy(asc(entries.language), asc(entries.lemma));

  for (const r of rows) {
    const list = byConcept.get(r.conceptId) ?? [];
    list.push({
      language: r.language,
      lemma: r.lemma,
      partOfSpeech: r.partOfSpeech,
      details: r.details,
    });
    byConcept.set(r.conceptId, list);
  }
  return byConcept;
}

// Inserts cards for the user, skipping any they already have. Returns how many
// were actually created. Callers must have verified the concepts are available
// in the direction. All cards in one call share an addedAt, and sortKey keeps
// their order (new cards are studied by addedAt, then sortKey). A caller adding
// several directions at once gives each a later addedAt, so one direction is
// always studied before the next however fast the inserts are.
export async function insertUserCards(
  db: Db,
  userId: string,
  items: { conceptId: string; sortKey: number }[],
  fromLanguage: string,
  toLanguage: string,
  addedAt: Date = new Date(),
): Promise<number> {
  let added = 0;
  const CHUNK = 1000;
  for (let i = 0; i < items.length; i += CHUNK) {
    const rows = await db
      .insert(userCards)
      .values(
        items.slice(i, i + CHUNK).map(({ conceptId, sortKey }) => ({
          userId,
          conceptId,
          sortKey,
          addedAt,
          fromLanguage,
          toLanguage,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: userCards.id });
    added += rows.length;
  }
  return added;
}

export const sentenceKey = (conceptId: string, language: string) =>
  `${conceptId}:${language}`;

// Example sentences attached to a concept's entries, keyed by sentenceKey().
// Capped per key; sentences are in the entry's language.
export async function loadSentences(
  db: Db,
  conceptIds: string[],
  languages: string[],
  cap = 2,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (conceptIds.length === 0 || languages.length === 0) return out;

  const rows = await db
    .select({
      conceptId: entries.conceptId,
      language: entries.language,
      text: sentences.text,
    })
    .from(entries)
    .innerJoin(entrySentences, eq(entrySentences.entryId, entries.id))
    .innerJoin(sentences, eq(sentences.id, entrySentences.sentenceId))
    .where(
      and(
        inArray(entries.conceptId, conceptIds),
        inArray(entries.language, languages),
        eq(sentences.language, entries.language),
      ),
    )
    .orderBy(asc(sentences.id));

  for (const r of rows) {
    const key = sentenceKey(r.conceptId, r.language);
    const list = out.get(key) ?? [];
    if (list.length < cap && !list.includes(r.text)) list.push(r.text);
    out.set(key, list);
  }
  return out;
}
