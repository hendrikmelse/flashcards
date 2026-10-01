import { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importPack } from "../src/content/import.js";
import { loadPacks } from "../src/content/load.js";
import { checkPack, packFileSchema, type PackFile } from "../src/content/pack-file.js";
import * as schema from "../src/db/schema.js";
import { concepts, entries, entrySentences, packConcepts, packs, sentences } from "../src/db/schema.js";
import { seedLanguages } from "../src/db/seed.js";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const count = async (table: PgTable) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seedLanguages(db);
}, 60_000);

afterAll(async () => {
  await pg.close();
});

const small = (): PackFile =>
  packFileSchema.parse({
    slug: "t",
    name: "Test",
    concepts: [
      {
        gloss: "dog (test)",
        entries: {
          en: [{ lemma: "dog", pos: "noun", sentences: ["The dog runs."] }],
          nl: [
            {
              lemma: "hond",
              pos: "noun",
              details: { article: "de", plural: "honden" },
              sentences: ["De hond rent."],
            },
          ],
        },
      },
      {
        gloss: "water (test)",
        entries: {
          en: [{ lemma: "water", pos: "noun", sentences: ["I drink water."] }],
          nl: [
            {
              lemma: "water",
              pos: "noun",
              details: { article: "het", uncountable: true },
              sentences: ["Ik drink water."],
            },
          ],
        },
      },
    ],
  });

describe("content files", () => {
  it("ship valid: every concept has both languages and Dutch nouns have articles", () => {
    const loaded = loadPacks("../../content/packs");
    expect(loaded.errors).toEqual([]);
    expect(loaded.packs.length).toBeGreaterThan(0);
  });

  it("flags a Dutch noun without an article and a missing language", () => {
    const pack = small();
    delete pack.concepts[0]!.entries["nl"]![0]!.details["article"];
    delete pack.concepts[1]!.entries["nl"];
    const { errors } = checkPack(pack);
    expect(errors.some((e) => e.includes("article"))).toBe(true);
    expect(errors.some((e) => e.includes("no nl entry"))).toBe(true);
  });
});

describe("verb form checks", () => {
  const verbPack = (en: Record<string, unknown>, nl: Record<string, unknown>) =>
    packFileSchema.parse({
      slug: "v",
      name: "Verbs",
      concepts: [
        {
          gloss: "run (test)",
          entries: {
            en: [{ lemma: "run", pos: "verb", details: en, sentences: ["I run."] }],
            nl: [{ lemma: "rennen", pos: "verb", details: nl, sentences: ["Ik ren."] }],
          },
        },
      ],
    });
  const goodEn = { past: "ran", participle: "run" };
  const goodNl = { pastSingular: "rende", pastPlural: "renden", participle: "gerend", auxiliary: "hebben/zijn" };

  it("accepts complete forms", () => {
    expect(checkPack(verbPack(goodEn, goodNl))).toEqual({ errors: [], warnings: [] });
  });

  it("warns about missing forms unless the verb is marked defective", () => {
    const { warnings } = checkPack(verbPack({ past: "ran" }, { ...goodNl, auxiliary: undefined }));
    expect(warnings.some((w) => w.includes("details.participle"))).toBe(true);
    expect(warnings.some((w) => w.includes("details.auxiliary"))).toBe(true);
    expect(checkPack(verbPack({ defective: true }, goodNl)).warnings).toEqual([]);
  });

  it("rejects an unknown auxiliary and an unknown present-tense pronoun", () => {
    const { errors } = checkPack(
      verbPack({ ...goodEn, present: { she: "runs" } }, { ...goodNl, auxiliary: "worden" }),
    );
    expect(errors.some((e) => e.includes("auxiliary"))).toBe(true);
    expect(errors.some((e) => e.includes('unknown pronoun "she"'))).toBe(true);
  });

  it("accepts a verb sentence that uses an inflected form", () => {
    const pack = verbPack(goodEn, goodNl);
    pack.concepts[0]!.entries["en"]![0]!.sentences = ["She ran home."];
    pack.concepts[0]!.entries["nl"]![0]!.sentences = ["Hij rende naar huis."];
    expect(checkPack(pack).warnings).toEqual([]);
  });
});

describe("importPack", () => {
  it("imports, is idempotent, and applies corrections", async () => {
    const first = await importPack(db, small());
    expect(first).toMatchObject({ concepts: 2, conceptsCreated: 2, entries: 4, sentences: 4 });
    expect(await count(concepts)).toBe(2);
    expect(await count(entries)).toBe(4);

    const again = await importPack(db, small());
    expect(again.conceptsCreated).toBe(0);
    expect(await count(concepts)).toBe(2);
    expect(await count(entries)).toBe(4);
    expect(await count(sentences)).toBe(4);
    expect(await count(entrySentences)).toBe(4);

    // Correct a lemma and a sentence, and reorder the pack.
    const fixed = small();
    fixed.concepts[0]!.entries["nl"]![0]!.lemma = "puppy";
    fixed.concepts[0]!.entries["en"]![0]!.sentences = ["The dog sleeps."];
    fixed.concepts.reverse();
    await importPack(db, fixed);

    const dutch = await db
      .select({ lemma: entries.lemma })
      .from(entries)
      .innerJoin(concepts, eq(concepts.id, entries.conceptId))
      .where(and(eq(concepts.gloss, "dog (test)"), eq(entries.language, "nl")));
    expect(dutch).toEqual([{ lemma: "puppy" }]);

    expect(await count(entries)).toBe(4);
    expect(await count(sentences)).toBe(4); // the old English sentence is gone

    const order = await db
      .select({ gloss: concepts.gloss })
      .from(packConcepts)
      .innerJoin(packs, eq(packs.id, packConcepts.packId))
      .innerJoin(concepts, eq(concepts.id, packConcepts.conceptId))
      .where(eq(packs.slug, "t"))
      .orderBy(packConcepts.position);
    expect(order.map((r) => r.gloss)).toEqual(["water (test)", "dog (test)"]);
  });

  it("imports the shipped starter pack", async () => {
    const { packs: shipped, errors } = loadPacks("../../content/packs");
    expect(errors).toEqual([]);
    for (const pack of shipped) {
      const s = await importPack(db, pack);
      expect(s.concepts).toBe(pack.concepts.length);
    }
  }, 60_000);
});
