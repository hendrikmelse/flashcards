import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import * as schema from "../src/db/schema.js";
import { concepts, entries, userCards } from "../src/db/schema.js";

// English verbs are stored with their "to" ("to run"), and found and sorted by the word after it.

let app: FastifyInstance;
let pg: PGlite;
let cookies: { session: string };

// [key, English lemma, part of speech, Dutch lemma]
const WORDS = [
  ["run-verb", "to run", "verb", "rennen"],
  ["runner", "runner", "noun", "loper"],
  ["abandon", "to abandon", "verb", "verlaten"],
  ["zip", "to zip", "verb", "ritsen"],
  ["bear", "bear", "noun", "beer"],
  ["tomato", "tomato", "noun", "tomaat"],
  ["can-verb", "can", "verb", "kunnen"],
] as const;

beforeAll(async () => {
  pg = new PGlite();
  const db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);
  app = await buildApp({ db, logger: false, authRateLimit: 1000 });
  const res = await app.inject({ method: "POST", url: "/auth/register", payload: { email: "verbs@example.com", password: "correct horse battery" } });
  cookies = { session: res.cookies.find((c) => c.name === "session")!.value };
  const me = (await app.inject({ method: "GET", url: "/auth/me", cookies })).json().user as { id: string };

  for (const [key, en, pos, nl] of WORDS) {
    const [c] = await db.insert(concepts).values({ key, gloss: key }).returning({ id: concepts.id });
    await db.insert(entries).values([
      { conceptId: c!.id, language: "en", lemma: en, partOfSpeech: pos },
      { conceptId: c!.id, language: "nl", lemma: nl, partOfSpeech: pos },
    ]);
    await db.insert(userCards).values({ userId: me.id, conceptId: c!.id, fromLanguage: "en", toLanguage: "nl" });
  }
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

const search = async (term: string) => {
  const res = await app.inject({ method: "GET", url: `/concepts/search?q=${encodeURIComponent(term)}&fromLanguage=en&toLanguage=nl` });
  return (res.json().concepts as { entries: { language: string; lemma: string }[] }[]).map(
    (c) => c.entries.find((e) => e.language === "en")!.lemma,
  );
};

describe("searching for an English verb", () => {
  it("treats the bare word as an exact match, ahead of longer words that start with it", async () => {
    expect(await search("run")).toEqual(["to run", "runner"]);
  });

  it("also finds it by the whole lemma, with the marker, and by part of it", async () => {
    expect(await search("to run")).toEqual(["to run"]);
    expect(await search("TO RUN")).toEqual(["to run"]);
    expect(await search("aband")).toEqual(["to abandon"]);
  });

  it("still finds a noun that starts with the same letters as the marker", async () => {
    // "to" is the start of "to run", "to abandon" and "to zip" as written, and of "tomato".
    const found = await search("to");
    expect(found).toContain("tomato");
    expect(found).toHaveLength(4);
  });
});

describe("sorting the deck by the English word", () => {
  it("files a verb under the word after the marker", async () => {
    const res = await app.inject({ method: "GET", url: "/deck?sort=alpha&limit=20", cookies });
    const lemmas = (res.json().cards as { front: { lemma: string }[] }[]).map((c) => c.front[0]!.lemma);
    expect(lemmas).toEqual(["to abandon", "bear", "can", "to run", "runner", "tomato", "to zip"]);
  });

  it("can be reversed", async () => {
    const res = await app.inject({ method: "GET", url: "/deck?sort=alpha&order=desc&limit=20", cookies });
    const lemmas = (res.json().cards as { front: { lemma: string }[] }[]).map((c) => c.front[0]!.lemma);
    expect(lemmas).toEqual(["to zip", "tomato", "runner", "to run", "can", "bear", "to abandon"]);
  });
});
