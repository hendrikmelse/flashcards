import { sql } from "drizzle-orm";
import { concepts, entries, languages, packConcepts, packs } from "./schema.js";
import type { Db } from "./types.js";

// The languages the app supports. Needed in every environment, including
// production, before any content or cards can exist. Idempotent.
export async function seedLanguages(db: Db) {
  await db
    .insert(languages)
    .values([
      { code: "en", name: "English" },
      { code: "nl", name: "Nederlands" },
    ])
    .onConflictDoNothing();
}

// Development only: languages plus tiny sample data to exercise the model.
// Real content will come from an import script over open datasets. Sample
// concepts are only inserted when the concepts table is empty.
export async function seed(db: Db) {
  await seedLanguages(db);

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(concepts);
  if (count > 0) return;

  const sample: { gloss: string; en: string; nl: string; article?: string }[] = [
    { gloss: "dog (domestic animal)", en: "dog", nl: "hond", article: "de" },
    { gloss: "house (building)", en: "house", nl: "huis", article: "het" },
    { gloss: "water (liquid)", en: "water", nl: "water", article: "het" },
  ];

  const [pack] = await db
    .insert(packs)
    .values({ slug: "sample", name: "Sample pack", description: "Demo data" })
    .onConflictDoNothing()
    .returning();

  for (const [i, s] of sample.entries()) {
    const [concept] = await db
      .insert(concepts)
      .values({ gloss: s.gloss })
      .returning();
    if (!concept) continue;
    await db.insert(entries).values([
      { conceptId: concept.id, language: "en", lemma: s.en, partOfSpeech: "noun" },
      {
        conceptId: concept.id,
        language: "nl",
        lemma: s.nl,
        partOfSpeech: "noun",
        details: s.article ? { article: s.article } : {},
      },
    ]);
    if (pack) {
      await db
        .insert(packConcepts)
        .values({ packId: pack.id, conceptId: concept.id, position: i });
    }
  }
}
