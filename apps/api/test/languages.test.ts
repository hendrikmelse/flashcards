import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it } from "vitest";
import {
  ADD_WORDS_DIRECTION,
  LANGUAGES,
  LANGUAGE_CODES,
  REQUIRED_LANGUAGES,
  formLines,
  languageCodeSchema,
  presentPronouns,
  verbFormKeys,
} from "@flashcards/shared";
import { checkConcept, type Concept } from "../src/content/content-schema.js";
import { seedLanguages } from "../src/db/seed.js";
import * as schema from "../src/db/schema.js";

describe("the list of supported languages", () => {
  it("has a code and a name for each, and the code schema accepts exactly those codes", () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual([...LANGUAGE_CODES]);
    expect(new Set(LANGUAGE_CODES).size).toBe(LANGUAGE_CODES.length);
    for (const l of LANGUAGES) {
      expect(l.name.length).toBeGreaterThan(0);
      expect(languageCodeSchema.safeParse(l.code).success).toBe(true);
    }
    expect(languageCodeSchema.safeParse("xx").success).toBe(false);
  });

  it("only names languages from the list in the settings that refer to them", () => {
    expect(ADD_WORDS_DIRECTION.from).not.toBe(ADD_WORDS_DIRECTION.to);
    for (const code of [ADD_WORDS_DIRECTION.from, ADD_WORDS_DIRECTION.to, ...REQUIRED_LANGUAGES]) {
      expect(LANGUAGE_CODES).toContain(code);
    }
  });

  it("is what seed-languages puts in the database, and can be run again", async () => {
    const pg = new PGlite();
    const db = drizzle(pg, { schema, casing: "snake_case" });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await seedLanguages(db);
    await seedLanguages(db);
    const rows = await db.select().from(schema.languages);
    expect(rows.map((r) => r.code).sort()).toEqual([...LANGUAGE_CODES].sort());
    for (const l of LANGUAGES) expect(rows.find((r) => r.code === l.code)?.name).toBe(l.name);
    await pg.close();
  });
});

describe("what depends on the language", () => {
  const concept = (entries: Concept["entries"]): Concept => ({ key: "dog", gloss: "dog", entries });
  const en = { lemma: "dog", pos: "noun" as const, details: { plural: "dogs" }, sentences: ["The dog runs."] };
  const nl = { lemma: "hond", pos: "noun" as const, details: { article: "de", plural: "honden" }, sentences: ["De hond rent."] };

  it("rejects entries in a language that is not supported", () => {
    const { errors } = checkConcept(concept({ en: [en], nl: [nl], xx: [en] }));
    expect(errors).toEqual([expect.stringContaining('unknown language "xx"')]);
  });

  it("accepts a word that has the required languages, and nothing else", () => {
    expect(checkConcept(concept({ en: [en], nl: [nl] })).errors).toEqual([]);
  });

  it("still holds Dutch nouns to having an article, and English ones not", () => {
    const noArticle = { ...nl, details: { plural: "honden" } };
    expect(checkConcept(concept({ en: [en], nl: [noArticle] })).errors).toEqual([
      expect.stringContaining("Dutch nouns need details.article"),
    ]);
    expect(checkConcept(concept({ en: [{ ...en, details: { plural: "dogs" } }], nl: [nl] })).errors).toEqual([]);
  });

  it("gives a language with no forms described just the noun plural, and no verb forms", () => {
    const details = { plural: "xs", past: "p", participle: "pp", pastSingular: "ps", present: { I: "go" } };
    expect(formLines("xx", details)).toEqual([{ label: "plural", value: "xs" }]);
    expect(verbFormKeys("xx")).toEqual([]);
    expect(presentPronouns("xx")).toBeUndefined();
  });

  it("keeps the forms of the languages that have them", () => {
    expect(formLines("en", { past: "ran", participle: "run" })).toEqual([
      { label: "past", value: "ran" },
      { label: "participle", value: "run" },
    ]);
    expect(formLines("nl", { pastSingular: "liep", pastPlural: "liepen", participle: "gelopen", auxiliary: "zijn" })).toEqual([
      { label: "past", value: "liep, liepen" },
      { label: "perfect", value: "is gelopen" },
    ]);
    expect(presentPronouns("nl")).toEqual(["ik", "jij", "hij", "wij"]);
    expect(verbFormKeys("en")).toEqual(["past", "participle"]);
  });
});
