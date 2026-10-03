import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  conceptSchema,
  languageFileSchema,
  packFileSchema,
  type Concept,
  type LanguageFile,
} from "../src/content/content-schema.js";
import { importContent } from "../src/content/import.js";
import { loadContent } from "../src/content/load.js";
import { collectPackTexts, mergeLanguageFiles, validateContent, type LanguageSource } from "../src/content/validate.js";
import * as schema from "../src/db/schema.js";
import { concepts, entries, languages, packTexts, packs, sentences, userCards, users } from "../src/db/schema.js";
import { seedLanguages } from "../src/db/seed.js";

// A third language, which the app does not support yet: these tests give the checks a list that has it.
const WITH_FRENCH = ["en", "nl", "fr"];

const dog: Concept = conceptSchema.parse({
  key: "dog",
  gloss: "dog (animal)",
  entries: {
    en: [{ lemma: "dog", pos: "noun", details: { plural: "dogs" }, sentences: ["The dog runs."] }],
    nl: [{ lemma: "hond", pos: "noun", details: { article: "de", plural: "honden" }, sentences: ["De hond rent."] }],
  },
});
const house: Concept = conceptSchema.parse({
  key: "house",
  gloss: "house (building)",
  entries: {
    en: [{ lemma: "house", pos: "noun", details: { plural: "houses" }, sentences: ["The house is big."] }],
    nl: [{ lemma: "huis", pos: "noun", details: { article: "het", plural: "huizen" }, sentences: ["Het huis is groot."] }],
  },
});

const fr = (...concepts: { key: string; lemma: string; sentence?: string }[]): LanguageFile =>
  languageFileSchema.parse({
    language: "fr",
    concepts: concepts.map((c) => ({
      key: c.key,
      entries: [
        {
          lemma: c.lemma,
          pos: "noun",
          details: { plural: `${c.lemma}s` },
          sentences: [c.sentence ?? `Le ${c.lemma} est ici.`],
        },
      ],
    })),
  });

const source = (content: LanguageFile, file = "languages/fr/a.json", folder = "fr"): LanguageSource => ({
  file,
  folder,
  content,
});
const conceptFiles = (...cs: Concept[]) => [{ file: "concepts/a.json", concepts: cs }];
const packFiles = (...keys: string[][]) =>
  keys.map((k, i) => ({ file: `packs/p${i}.json`, pack: packFileSchema.parse({ slug: `p${i}`, name: `p${i}`, category: "topic", concepts: k }) }));

describe("language files: validation", () => {
  const check = (langFiles: LanguageSource[]) =>
    validateContent(conceptFiles(dog, house), packFiles(["dog", "house"]), langFiles, WITH_FRENCH);

  it("accepts a language's entries for concepts that exist", () => {
    const { errors, warnings } = check([source(fr({ key: "dog", lemma: "chien" }, { key: "house", lemma: "maison" }))]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("accepts entries for only some of the concepts", () => {
    expect(check([source(fr({ key: "dog", lemma: "chien" }))]).errors).toEqual([]);
  });

  it("rejects entries for a concept that does not exist", () => {
    const { errors } = check([source(fr({ key: "cat", lemma: "chat" }))]);
    expect(errors).toEqual([expect.stringContaining('unknown concept "cat"')]);
  });

  it("rejects a language that is not supported", () => {
    const wrong = { ...fr({ key: "dog", lemma: "chien" }), language: "xx" };
    const { errors } = check([source(wrong, "languages/xx/a.json", "xx")]);
    expect(errors).toEqual([expect.stringContaining('unknown language "xx"')]);
  });

  it("rejects a file that says it is for a different language than its folder", () => {
    const { errors } = check([source(fr({ key: "dog", lemma: "chien" }), "languages/nl/a.json", "nl")]);
    expect(errors).toEqual([expect.stringContaining('says it is for "fr" but is in the folder for "nl"')]);
  });

  it("rejects a language the concept files already cover", () => {
    const dutch = { ...fr({ key: "dog", lemma: "hond" }), language: "nl" };
    const { errors } = check([source(dutch, "languages/nl/a.json", "nl")]);
    expect(errors).toEqual([expect.stringContaining('"dog" already has nl entries in concepts/a.json')]);
  });

  it("rejects the same concept in the same language in two files", () => {
    const { errors } = check([
      source(fr({ key: "dog", lemma: "chien" }), "languages/fr/a.json"),
      source(fr({ key: "dog", lemma: "toutou" }), "languages/fr/b.json"),
    ]);
    expect(errors).toEqual([expect.stringContaining('"dog" already has fr entries in languages/fr/a.json')]);
  });

  it("applies the checks for entries to them, naming the file", () => {
    const { warnings } = check([source(fr({ key: "dog", lemma: "chien", sentence: "Il fait beau." }))]);
    expect(warnings).toEqual([
      expect.stringMatching(/^languages\/fr\/a\.json: "dog" fr "chien": sentence does not contain the lemma/),
    ]);
  });
});

describe("language files: merging", () => {
  it("adds each language's entries to the concepts, in the order of the concept files", () => {
    const merged = mergeLanguageFiles(conceptFiles(dog, house), [source(fr({ key: "house", lemma: "maison" }))]);
    expect(merged.map((c) => c.key)).toEqual(["dog", "house"]);
    expect(Object.keys(merged[0]!.entries).sort()).toEqual(["en", "nl"]); // no French for dog
    expect(Object.keys(merged[1]!.entries).sort()).toEqual(["en", "fr", "nl"]);
    expect(merged[1]!.entries["fr"]![0]!.lemma).toBe("maison");
  });

  it("leaves the concept files' own entries alone", () => {
    const merged = mergeLanguageFiles(conceptFiles(dog), [source(fr({ key: "dog", lemma: "chien" }))]);
    expect(merged[0]!.entries["nl"]).toEqual(dog.entries["nl"]);
    expect(dog.entries["fr"]).toBeUndefined(); // the input is not changed
  });
});

describe("language files: loading from disk", () => {
  let dir: string;
  const write = (path: string, data: unknown) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(data));
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "content-"));
    write("concepts/a.json", { concepts: [dog, house] });
    write("packs/p.json", { slug: "p", name: "p", category: "topic", concepts: ["dog", "house"] });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("works with no languages folder at all", () => {
    const loaded = loadContent(dir, WITH_FRENCH);
    expect(loaded.errors).toEqual([]);
    expect(loaded.concepts).toHaveLength(2);
  });

  it("merges the files of each language folder", () => {
    write("languages/fr/a.json", fr({ key: "dog", lemma: "chien" }));
    write("languages/fr/b.json", fr({ key: "house", lemma: "maison" }));
    const loaded = loadContent(dir, WITH_FRENCH);
    expect(loaded.errors).toEqual([]);
    expect(loaded.concepts.map((c) => Object.keys(c.entries).sort())).toEqual([
      ["en", "fr", "nl"],
      ["en", "fr", "nl"],
    ]);
  });

  it("reports a language file that is not valid JSON or does not match the format", () => {
    mkdirSync(join(dir, "languages/fr"), { recursive: true });
    writeFileSync(join(dir, "languages/fr/a.json"), "{ nope");
    write("languages/fr/b.json", { language: "fr", concepts: [] });
    const { errors } = loadContent(dir, WITH_FRENCH);
    expect(errors.some((e) => e.startsWith("languages/fr/a.json:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("languages/fr/b.json:") && e.includes("neither concepts nor packs"))).toBe(true);
  });

  it("reports a language the app does not support", () => {
    write("languages/fr/a.json", fr({ key: "dog", lemma: "chien" }));
    const { errors } = loadContent(dir); // the real list of languages has no French
    expect(errors).toEqual([expect.stringContaining('unknown language "fr"')]);
  });
});

describe("language files: importing", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pg = new PGlite();
    db = drizzle(pg, { schema, casing: "snake_case" });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await seedLanguages(db);
    await db.insert(languages).values({ code: "fr", name: "Français" });
  }, 60_000);
  beforeEach(async () => {
    await db.delete(userCards);
    await db.delete(users);
    await db.delete(concepts);
    await db.delete(packs);
    await db.delete(sentences);
  });
  afterAll(async () => {
    await pg.close();
  });

  const merged = (...files: LanguageFile[]) =>
    mergeLanguageFiles(conceptFiles(dog, house), files.map((f) => source(f)));
  const pack = [packFileSchema.parse({ slug: "p", name: "p", category: "topic", concepts: ["dog", "house"] })];
  const lemmas = async () =>
    (await db.select({ language: entries.language, lemma: entries.lemma }).from(entries))
      .map((e) => `${e.language}:${e.lemma}`)
      .sort();

  it("stores the entries of a language file next to the concept file's own", async () => {
    await importContent(db, { concepts: merged(fr({ key: "dog", lemma: "chien" })), packs: pack });
    expect(await lemmas()).toEqual(["en:dog", "en:house", "fr:chien", "nl:hond", "nl:huis"]);
  });

  it("adds a language to a database that already has the others, without touching them", async () => {
    await importContent(db, { concepts: merged(), packs: pack });
    const before = await db.select().from(entries).where(eq(entries.language, "nl"));

    await importContent(db, { concepts: merged(fr({ key: "dog", lemma: "chien" }, { key: "house", lemma: "maison" })), packs: pack });
    expect(await lemmas()).toEqual(["en:dog", "en:house", "fr:chien", "fr:maison", "nl:hond", "nl:huis"]);
    const after = await db.select().from(entries).where(eq(entries.language, "nl"));
    expect(after.map((e) => e.id).sort()).toEqual(before.map((e) => e.id).sort());
  });

  it("is idempotent, and dropping an entry from a language file removes it", async () => {
    const both = fr({ key: "dog", lemma: "chien" }, { key: "house", lemma: "maison" });
    await importContent(db, { concepts: merged(both), packs: pack });
    await importContent(db, { concepts: merged(both), packs: pack });
    expect((await lemmas()).filter((l) => l.startsWith("fr:"))).toEqual(["fr:chien", "fr:maison"]);

    await importContent(db, { concepts: merged(fr({ key: "dog", lemma: "chien" })), packs: pack });
    expect((await lemmas()).filter((l) => l.startsWith("fr:"))).toEqual(["fr:chien"]);
  });

  it("stores the language a pack teaches, and updates it on a later import", async () => {
    const tagged = (target?: string) => [
      packFileSchema.parse({ slug: "p", name: "p", category: "topic", concepts: ["dog"], ...(target ? { target } : {}) }),
    ];
    const target = async () => (await db.select().from(packs))[0]!.target;
    await importContent(db, { concepts: merged(), packs: tagged("nl") });
    expect(await target()).toBe("nl");
    await importContent(db, { concepts: merged(), packs: tagged() });
    expect(await target()).toBeNull();
  });

  it("does not accept a pack for a language that is not supported", () => {
    expect(packFileSchema.safeParse({ slug: "p", name: "p", category: "topic", target: "xx", concepts: ["dog"] }).success).toBe(false);
  });
});

// ---- pack names and descriptions in other languages

const packTextFile = (language: string, ...packs: { slug: string; name: string; description?: string }[]): LanguageFile =>
  languageFileSchema.parse({ language, packs });

describe("language files: pack names and descriptions", () => {
  // Two packs, p0 and p1.
  const check = (langFiles: LanguageSource[]) =>
    validateContent(conceptFiles(dog, house), packFiles(["dog"], ["house"]), langFiles, WITH_FRENCH);

  it("accepts a language's text for packs that exist, with or without a description", () => {
    const file = packTextFile("fr", { slug: "p0", name: "Mots", description: "Des mots" }, { slug: "p1", name: "x" });
    expect(check([source(file)]).errors).toEqual([]);
  });

  it("can hold concepts, packs or both, but not nothing", () => {
    expect(languageFileSchema.safeParse({ language: "fr" }).success).toBe(false);
    expect(languageFileSchema.safeParse({ language: "fr", concepts: [], packs: [] }).success).toBe(false);
    expect(languageFileSchema.safeParse({ language: "fr", packs: [{ slug: "p0", name: "Mots" }] }).success).toBe(true);
  });

  it("rejects text for a pack that does not exist", () => {
    const { errors } = check([source(packTextFile("fr", { slug: "nope", name: "Mots" }))]);
    expect(errors).toEqual([expect.stringContaining('unknown pack "nope"')]);
  });

  it("rejects two texts for the same pack and language", () => {
    const { errors } = check([
      source(packTextFile("fr", { slug: "p0", name: "Mots" }), "languages/fr/a.json"),
      source(packTextFile("fr", { slug: "p0", name: "Autres mots" }), "languages/fr/b.json"),
    ]);
    expect(errors).toEqual([expect.stringContaining('pack "p0" already has fr text in languages/fr/a.json')]);
  });

  it("rejects text in the language the pack files are written in", () => {
    const english = packTextFile("en", { slug: "p0", name: "Words" });
    const { errors } = check([source(english, "languages/en/a.json", "en")]);
    expect(errors).toEqual([expect.stringContaining("belong in the pack files")]);
  });

  it("collects the texts of all the files", () => {
    const texts = collectPackTexts([
      source(packTextFile("fr", { slug: "p0", name: "Mots", description: "Des mots" })),
      source(packTextFile("nl", { slug: "p0", name: "Woorden" }), "languages/nl/a.json", "nl"),
    ]);
    expect(texts).toEqual([
      { slug: "p0", language: "fr", name: "Mots", description: "Des mots" },
      { slug: "p0", language: "nl", name: "Woorden", description: undefined },
    ]);
  });
});

describe("language files: pack texts on disk and in the database", () => {
  let dir: string;
  const write = (path: string, data: unknown) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(data));
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "content-"));
    write("concepts/a.json", { concepts: [dog, house] });
    write("packs/p.json", { slug: "p", name: "Pack", description: "A pack", category: "topic", concepts: ["dog", "house"] });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("loads the texts from a language folder, next to concepts in the same file", () => {
    write("languages/fr/a.json", {
      language: "fr",
      packs: [{ slug: "p", name: "Paquet", description: "Un paquet" }],
      concepts: fr({ key: "dog", lemma: "chien" }).concepts,
    });
    const loaded = loadContent(dir, WITH_FRENCH);
    expect(loaded.errors).toEqual([]);
    expect(loaded.packTexts).toEqual([{ slug: "p", language: "fr", name: "Paquet", description: "Un paquet" }]);
    expect(Object.keys(loaded.concepts[0]!.entries).sort()).toEqual(["en", "fr", "nl"]);
  });

  it("has none when there is no languages folder", () => {
    expect(loadContent(dir, WITH_FRENCH).packTexts).toEqual([]);
  });

  describe("importing", () => {
    let pg: PGlite;
    let db: ReturnType<typeof drizzle<typeof schema>>;
    beforeAll(async () => {
      pg = new PGlite();
      db = drizzle(pg, { schema, casing: "snake_case" });
      await migrate(db, { migrationsFolder: "./drizzle" });
      await seedLanguages(db);
      await db.insert(languages).values({ code: "fr", name: "Français" });
    }, 60_000);
    beforeEach(async () => {
      await db.delete(packs);
      await db.delete(concepts);
    });
    afterAll(async () => {
      await pg.close();
    });

    const pack = [packFileSchema.parse({ slug: "p", name: "Pack", category: "topic", concepts: ["dog"] })];
    const texts = async () =>
      (await db.select().from(packTexts)).map((t) => `${t.language}:${t.name}:${t.description}`).sort();

    it("stores the texts, rewrites them on a later import, and drops those no longer in the files", async () => {
      const base = { concepts: [dog], packs: pack };
      const summary = await importContent(db, {
        ...base,
        packTexts: [
          { slug: "p", language: "fr", name: "Paquet", description: "Un paquet" },
          { slug: "p", language: "nl", name: "Pakket" },
        ],
      });
      expect(summary.packTexts).toBe(2);
      expect(await texts()).toEqual(["fr:Paquet:Un paquet", "nl:Pakket:null"]);

      await importContent(db, { ...base, packTexts: [{ slug: "p", language: "fr", name: "Lot", description: "Un lot" }] });
      expect(await texts()).toEqual(["fr:Lot:Un lot"]);

      await importContent(db, base);
      expect(await texts()).toEqual([]);
    });

    it("goes with the pack when it is removed", async () => {
      await importContent(db, { concepts: [dog], packs: pack, packTexts: [{ slug: "p", language: "fr", name: "Paquet" }] });
      await db.delete(packs);
      expect(await texts()).toEqual([]);
    });
  });
});
