import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { PACK_CATEGORIES } from "@flashcards/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  checkConcept,
  conceptSchema,
  packFileSchema,
  type Concept,
  type PackFile,
} from "../src/content/content-schema.js";
import { importContent } from "../src/content/import.js";
import { loadContent } from "../src/content/load.js";
import { validateContent } from "../src/content/validate.js";
import * as schema from "../src/db/schema.js";
import {
  concepts,
  entries,
  entrySentences,
  packConcepts,
  packs,
  sentences,
  userCards,
  users,
} from "../src/db/schema.js";
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

beforeEach(async () => {
  // Cascades remove entries, sentence links, pack membership and cards.
  await db.delete(userCards);
  await db.delete(users);
  await db.delete(concepts);
  await db.delete(packs);
  await db.delete(sentences);
});

afterAll(async () => {
  await pg.close();
});

const noun = (key: string, en: string, nl: string, article = "de"): Concept =>
  conceptSchema.parse({
    key,
    gloss: `${key} (test)`,
    entries: {
      en: [{ lemma: en, pos: "noun", details: { plural: `${en}s` }, sentences: [`The ${en} runs.`] }],
      nl: [
        {
          lemma: nl,
          pos: "noun",
          details: { article, plural: `${nl}en` },
          sentences: [`De ${nl} rent.`],
        },
      ],
    },
  });

const pack = (slug: string, keys: string[], category = "topic"): PackFile =>
  packFileSchema.parse({ slug, name: slug, category, concepts: keys });

describe("shipped content", () => {
  it("validates, and shares concepts between packs", () => {
    const loaded = loadContent("../../content");
    expect(loaded.errors).toEqual([]);
    expect(loaded.packs.length).toBeGreaterThan(1);

    const packsPerConcept = new Map<string, number>();
    for (const p of loaded.packs) {
      for (const key of p.concepts) packsPerConcept.set(key, (packsPerConcept.get(key) ?? 0) + 1);
    }
    expect([...packsPerConcept.values()].some((n) => n > 1)).toBe(true);
  });

  it("keeps keys language-neutral: English words only, no Dutch lemma on the end", () => {
    const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const { concepts: cs } = loadContent("../../content");
    const offenders = cs
      .filter((c) => {
        const english = (c.entries.en ?? []).map((e) => slug(e.lemma));
        return (c.entries.nl ?? []).some((e) => {
          const nl = slug(e.lemma);
          return !english.includes(nl) && new RegExp(`(^|-)${nl}(-[0-9]+)?$`).test(c.key) && !c.key.startsWith(nl);
        });
      })
      .map((c) => c.key);
    // "comic-strip" ends in the Dutch word "strip" by coincidence
    expect(offenders.filter((k) => k !== "comic-strip")).toEqual([]);
  });

  it("gives every pack a category, and every category a handful of packs", () => {
    const { packs: ps } = loadContent("../../content");
    const perCategory = new Map<string, number>();
    for (const p of ps) perCategory.set(p.category, (perCategory.get(p.category) ?? 0) + 1);
    // Only categories with at least a handful of packs are worth having.
    for (const category of PACK_CATEGORIES) expect(perCategory.get(category) ?? 0).toBeGreaterThanOrEqual(5);
    expect([...perCategory.keys()].every((c) => (PACK_CATEGORIES as readonly string[]).includes(c))).toBe(true);
    // The frequency bands are the most common words.
    expect(ps.filter((p) => p.slug.startsWith("top-")).every((p) => p.category === "common")).toBe(true);
  });

  it("rejects a pack with a missing or unknown category", () => {
    expect(packFileSchema.safeParse({ slug: "a", name: "A", concepts: ["x"] }).success).toBe(false);
    expect(packFileSchema.safeParse({ slug: "a", name: "A", category: "misc", concepts: ["x"] }).success).toBe(false);
    expect(packFileSchema.safeParse({ slug: "a", name: "A", category: "topic", concepts: ["x"] }).success).toBe(true);
  });

  it("imports into an empty database", async () => {
    const { concepts: cs, packs: ps } = loadContent("../../content");
    const summary = await importContent(db, { concepts: cs, packs: ps });
    expect(summary.concepts).toBe(cs.length);
    expect(await count(concepts)).toBe(cs.length);
    expect(await count(packs)).toBe(ps.length);
  }, 60_000);
});

describe("shipped packs for learning Dutch", () => {
  it("are tagged, so people learning other languages are not shown them", () => {
    const { packs: ps } = loadContent("../../content");
    const dutch = ps.filter((p) => p.target === "nl").map((p) => p.slug);
    // The frequency bands come from a Dutch word list.
    for (const p of ps.filter((p) => p.slug.startsWith("top-"))) expect(p.target, p.slug).toBe("nl");
    expect(dutch).toEqual(expect.arrayContaining(["prepositions", "pronominal-adverbs", "dutch-culture"]));
    // Topics and the starter words suit any language.
    for (const slug of ["starter", "animals-basics", "colors"]) {
      expect(ps.find((p) => p.slug === slug)?.target, slug).toBeUndefined();
    }
  });
});

describe("validateContent", () => {
  const files = (...cs: Concept[][]) => cs.map((concepts, i) => ({ file: `c${i}.json`, concepts }));
  const packFiles = (...ps: PackFile[]) => ps.map((p) => ({ file: `${p.slug}.json`, pack: p }));

  it("accepts the same concept in several packs", () => {
    const cs = [noun("dog", "dog", "hond"), noun("house", "house", "huis", "het")];
    const check = validateContent(
      files(cs),
      packFiles(pack("a", ["dog", "house"]), pack("b", ["house", "dog"])),
    );
    expect(check).toEqual({ errors: [], warnings: [] });
  });

  it("rejects a key defined in two files", () => {
    const { errors } = validateContent(
      files([noun("dog", "dog", "hond")], [noun("dog", "dog", "hond")]),
      packFiles(pack("a", ["dog"])),
    );
    expect(errors.some((e) => e.includes('key "dog" is also defined in c0.json'))).toBe(true);
  });

  it("rejects a pack that lists an unknown or repeated concept", () => {
    const { errors } = validateContent(
      files([noun("dog", "dog", "hond")]),
      packFiles(pack("a", ["dog", "dog", "cat"])),
    );
    expect(errors.some((e) => e.includes('"dog" is listed twice'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown concept "cat"'))).toBe(true);
  });

  it("warns about a concept that no pack lists", () => {
    const { warnings } = validateContent(
      files([noun("dog", "dog", "hond"), noun("cat", "cat", "kat")]),
      packFiles(pack("a", ["dog"])),
    );
    expect(warnings.some((w) => w.includes('"cat" is not in any pack'))).toBe(true);
  });

  it("rejects a key that is not lowercase hyphenated", () => {
    expect(conceptSchema.safeParse({ ...noun("dog", "dog", "hond"), key: "Dog Food" }).success).toBe(
      false,
    );
    expect(packFileSchema.safeParse({ slug: "ok", name: "x", concepts: ["bad_key"] }).success).toBe(
      false,
    );
  });
});

describe("checkConcept", () => {
  it("flags a Dutch noun without an article and a missing language", () => {
    const c = noun("dog", "dog", "hond");
    delete c.entries["nl"]![0]!.details["article"];
    delete c.entries["en"];
    const { errors } = checkConcept(c);
    expect(errors.some((e) => e.includes("article"))).toBe(true);
    expect(errors.some((e) => e.includes("no en entry"))).toBe(true);
  });

  describe("verb forms", () => {
    const verb = (en: Record<string, unknown>, nl: Record<string, unknown>) =>
      conceptSchema.parse({
        key: "run",
        gloss: "run (test)",
        entries: {
          en: [{ lemma: "run", pos: "verb", details: en, sentences: ["I run."] }],
          nl: [{ lemma: "rennen", pos: "verb", details: nl, sentences: ["Ik ren."] }],
        },
      });
    const goodEn = { past: "ran", participle: "run" };
    const goodNl = {
      pastSingular: "rende",
      pastPlural: "renden",
      participle: "gerend",
      auxiliary: "hebben/zijn",
    };

    it("accepts complete forms", () => {
      expect(checkConcept(verb(goodEn, goodNl))).toEqual({ errors: [], warnings: [] });
    });

    it("warns about missing forms unless the verb is marked defective", () => {
      const { warnings } = checkConcept(verb({ past: "ran" }, { ...goodNl, auxiliary: undefined }));
      expect(warnings.some((w) => w.includes("details.participle"))).toBe(true);
      expect(warnings.some((w) => w.includes("details.auxiliary"))).toBe(true);
      expect(checkConcept(verb({ defective: true }, goodNl)).warnings).toEqual([]);
    });

    it("rejects an unknown auxiliary and an unknown present-tense pronoun", () => {
      const { errors } = checkConcept(
        verb({ ...goodEn, present: { she: "runs" } }, { ...goodNl, auxiliary: "worden" }),
      );
      expect(errors.some((e) => e.includes("auxiliary"))).toBe(true);
      expect(errors.some((e) => e.includes('unknown pronoun "she"'))).toBe(true);
    });

    it("accepts a verb sentence that uses an inflected form", () => {
      const c = verb(goodEn, goodNl);
      c.entries["en"]![0]!.sentences = ["She ran home."];
      c.entries["nl"]![0]!.sentences = ["Hij rende naar huis."];
      expect(checkConcept(c).warnings).toEqual([]);
    });
  });
});

describe("importContent", () => {
  it("stores each pack's category, and updates it on a later import", async () => {
    const cs = [noun("dog", "dog", "hond")];
    await importContent(db, { concepts: cs, packs: [pack("a", ["dog"], "common"), pack("b", ["dog"], "verbs")] });
    const byCategory = async () =>
      Object.fromEntries((await db.select().from(packs)).map((p) => [p.slug, p.category]));
    expect(await byCategory()).toEqual({ a: "common", b: "verbs" });

    await importContent(db, { concepts: cs, packs: [pack("a", ["dog"], "grammar"), pack("b", ["dog"], "verbs")] });
    expect(await byCategory()).toEqual({ a: "grammar", b: "verbs" });
  });

  it("puts one concept in several packs without duplicating it", async () => {
    const cs = [noun("dog", "dog", "hond"), noun("house", "house", "huis", "het")];
    const summary = await importContent(db, {
      concepts: cs,
      packs: [pack("a", ["dog", "house"]), pack("b", ["house"])],
    });
    expect(summary).toMatchObject({ concepts: 2, conceptsCreated: 2, packs: 2 });
    expect(await count(concepts)).toBe(2);
    expect(await count(packConcepts)).toBe(3);

    const [house] = await db.select().from(concepts).where(eq(concepts.key, "house"));
    const memberships = await db
      .select()
      .from(packConcepts)
      .where(eq(packConcepts.conceptId, house!.id));
    expect(memberships).toHaveLength(2);
  });

  it("is idempotent and applies corrections, including reordering a pack", async () => {
    const make = () => ({
      concepts: [noun("dog", "dog", "hond"), noun("water", "water", "water", "het")],
      packs: [pack("t", ["dog", "water"])],
    });
    const first = await importContent(db, make());
    expect(first).toMatchObject({ conceptsCreated: 2, entries: 4, sentences: 4 });

    const again = await importContent(db, make());
    expect(again.conceptsCreated).toBe(0);
    expect(await count(concepts)).toBe(2);
    expect(await count(entries)).toBe(4);
    expect(await count(sentences)).toBe(4);
    expect(await count(entrySentences)).toBe(4);

    const fixed = make();
    fixed.concepts[0]!.entries["nl"]![0]!.lemma = "puppy";
    fixed.concepts[0]!.entries["en"]![0]!.sentences = ["The dog sleeps."];
    fixed.concepts[0]!.gloss = "dog (reworded)";
    fixed.packs = [pack("t", ["water", "dog"])];
    await importContent(db, fixed);

    const [dog] = await db.select().from(concepts).where(eq(concepts.key, "dog"));
    expect(dog!.gloss).toBe("dog (reworded)"); // rewording the gloss keeps the concept
    const rows = await db
      .select({ language: entries.language, lemma: entries.lemma })
      .from(entries)
      .where(eq(entries.conceptId, dog!.id));
    expect(rows.map((e) => `${e.language}:${e.lemma}`).sort()).toEqual(["en:dog", "nl:puppy"]);
    expect(await count(sentences)).toBe(4); // the old English sentence is gone

    const order = await db
      .select({ key: concepts.key })
      .from(packConcepts)
      .innerJoin(concepts, eq(concepts.id, packConcepts.conceptId))
      .orderBy(packConcepts.position);
    expect(order.map((r) => r.key)).toEqual(["water", "dog"]);
  });

  it("gives a keyless legacy concept its key instead of duplicating it", async () => {
    const [legacy] = await db
      .insert(concepts)
      .values({ key: "legacy:123", gloss: "dog (test)" })
      .returning();
    const [user] = await db
      .insert(users)
      .values({ email: "a@example.com", passwordHash: "x" })
      .returning();
    await db
      .insert(userCards)
      .values({ userId: user!.id, conceptId: legacy!.id, fromLanguage: "en", toLanguage: "nl" });

    const summary = await importContent(db, {
      concepts: [noun("dog", "dog", "hond")],
      packs: [pack("a", ["dog"])],
    });

    expect(summary).toMatchObject({ conceptsCreated: 0, conceptsAdopted: 1 });
    expect(await count(concepts)).toBe(1);
    const [adopted] = await db.select().from(concepts);
    expect(adopted).toMatchObject({ id: legacy!.id, key: "dog" });
    expect(await count(userCards)).toBe(1); // the card still points at it
  });

  it("reports but never deletes concepts or packs the files no longer mention", async () => {
    await importContent(db, {
      concepts: [noun("dog", "dog", "hond"), noun("cat", "cat", "kat")],
      packs: [pack("a", ["dog", "cat"]), pack("old", ["cat"])],
    });
    const summary = await importContent(db, {
      concepts: [noun("dog", "dog", "hond")],
      packs: [pack("a", ["dog"])],
    });
    expect(summary.conceptsNotInFiles).toEqual(["cat"]);
    expect(summary.packsNotInFiles).toEqual(["old"]);
    expect(await count(concepts)).toBe(2);
    expect(await count(packs)).toBe(2);
  });

  it("changes nothing when a pack lists a missing concept", async () => {
    await expect(
      importContent(db, {
        concepts: [noun("dog", "dog", "hond")],
        packs: [pack("a", ["dog", "nope"])],
      }),
    ).rejects.toThrow(/unknown concept "nope"/);
    expect(await count(concepts)).toBe(0); // rolled back
  });
});
