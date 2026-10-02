import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import * as schema from "../src/db/schema.js";
import { concepts, entries, packConcepts } from "../src/db/schema.js";

let app: FastifyInstance;
let pg: PGlite;
let packId: string;
let orphanConceptId: string;
let cookies: { session: string };

const EN_NL = { fromLanguage: "en", toLanguage: "nl" };
const NL_EN = { fromLanguage: "nl", toLanguage: "en" };

beforeAll(async () => {
  pg = new PGlite();
  const db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);

  // A concept that only exists in English (no Dutch entry yet), added to the pack.
  const [orphan] = await db.insert(concepts).values({ key: "orphan", gloss: "orphan" }).returning();
  orphanConceptId = orphan!.id;
  await db
    .insert(entries)
    .values({ conceptId: orphanConceptId, language: "en", lemma: "orphan" });

  app = await buildApp({ db, logger: false });

  const packs = await app.inject({ method: "GET", url: "/packs" });
  packId = packs.json().packs[0].id;
  await db.insert(packConcepts).values({ packId, conceptId: orphanConceptId, position: 99 });

  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email: "learner@example.com", password: "correct horse battery" },
  });
  cookies = { session: reg.cookies.find((c) => c.name === "session")!.value };
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

const q = (d: Record<string, string>) => new URLSearchParams(d).toString();

describe("public content", () => {
  it("lists languages", async () => {
    const res = await app.inject({ method: "GET", url: "/languages" });
    expect(res.json().languages.map((l: { code: string }) => l.code)).toEqual(["en", "nl"]);
  });

  it("lists packs with concept counts, and availability for a direction", async () => {
    const plain = await app.inject({ method: "GET", url: "/packs" });
    expect(plain.json().packs[0]).toMatchObject({ slug: "sample", conceptCount: 4 });
    expect(plain.json().packs[0].availableCount).toBeUndefined();

    const dir = await app.inject({ method: "GET", url: `/packs?${q(EN_NL)}` });
    expect(dir.json().packs[0]).toMatchObject({ conceptCount: 4, availableCount: 3 });
    expect(dir.json().packs[0].addedCount).toBeUndefined(); // anonymous
  });

  it("rejects a half-specified or same-language direction", async () => {
    const half = await app.inject({ method: "GET", url: "/packs?fromLanguage=en" });
    expect(half.statusCode).toBe(400);
    const same = await app.inject({
      method: "GET",
      url: `/packs?${q({ fromLanguage: "en", toLanguage: "en" })}`,
    });
    expect(same.statusCode).toBe(400);
  });

  it("shows pack concepts in order with entries and availability", async () => {
    const res = await app.inject({ method: "GET", url: `/packs/${packId}?${q(EN_NL)}` });
    const body = res.json();
    expect(body.concepts).toHaveLength(4);
    expect(body.concepts[0].entries.map((e: { lemma: string }) => e.lemma)).toEqual([
      "dog",
      "hond",
    ]);
    expect(body.concepts[0].entries[1].details).toEqual({ article: "de" });
    expect(body.concepts.map((c: { available: boolean }) => c.available)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("404s for an unknown pack and 400s for a malformed id", async () => {
    const missing = await app.inject({
      method: "GET",
      url: "/packs/00000000-0000-0000-0000-000000000000",
    });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({ method: "GET", url: "/packs/not-a-uuid" });
    expect(bad.statusCode).toBe(400);
  });
});

describe("adding to the deck", () => {
  it("requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/packs/${packId}/add`,
      payload: EN_NL,
    });
    expect(res.statusCode).toBe(401);
    const deck = await app.inject({ method: "GET", url: "/deck" });
    expect(deck.statusCode).toBe(401);
  });

  it("adds available concepts from a pack, skipping unavailable ones", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/packs/${packId}/add`,
      payload: EN_NL,
      cookies,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ added: 3, alreadyInDeck: 0, unavailable: 1 });
  });

  it("is idempotent", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/packs/${packId}/add`,
      payload: EN_NL,
      cookies,
    });
    expect(res.json()).toEqual({ added: 0, alreadyInDeck: 3, unavailable: 1 });
  });

  it("treats the reverse direction as separate cards", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/packs/${packId}/add`,
      payload: NL_EN,
      cookies,
    });
    expect(res.json().added).toBe(3);
  });

  it("reflects the deck in pack listings and pack detail", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/packs?${q(EN_NL)}`,
      cookies,
    });
    expect(list.json().packs[0]).toMatchObject({ availableCount: 3, addedCount: 3 });

    const detail = await app.inject({
      method: "GET",
      url: `/packs/${packId}?${q(EN_NL)}`,
      cookies,
    });
    expect(detail.json().concepts.map((c: { inDeck: boolean }) => c.inDeck)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("adds a single concept, rejecting ones without both languages", async () => {
    const bad = await app.inject({
      method: "POST",
      url: `/concepts/${orphanConceptId}/add`,
      payload: EN_NL,
      cookies,
    });
    expect(bad.statusCode).toBe(422);

    const missing = await app.inject({
      method: "POST",
      url: "/concepts/00000000-0000-0000-0000-000000000000/add",
      payload: EN_NL,
      cookies,
    });
    expect(missing.statusCode).toBe(404);

    const invalid = await app.inject({
      method: "POST",
      url: `/packs/${packId}/add`,
      payload: { fromLanguage: "en", toLanguage: "en" },
      cookies,
    });
    expect(invalid.statusCode).toBe(400);
  });
});

describe("GET /deck", () => {
  it("summarizes the deck and resolves front/back for each card's direction", async () => {
    const res = await app.inject({ method: "GET", url: "/deck", cookies });
    const body = res.json();
    expect(body.summary).toMatchObject({ total: 6, new: 6, dueNow: 0 });
    expect(body.cards).toHaveLength(6);

    const dogEnNl = body.cards.find(
      (c: { fromLanguage: string; front: { lemma: string }[] }) =>
        c.fromLanguage === "en" && c.front[0]?.lemma === "dog",
    );
    expect(dogEnNl.back[0]).toMatchObject({ lemma: "hond", details: { article: "de" } });
    const dogNlEn = body.cards.find(
      (c: { fromLanguage: string; front: { lemma: string }[] }) =>
        c.fromLanguage === "nl" && c.front[0]?.lemma === "hond",
    );
    expect(dogNlEn.back[0].lemma).toBe("dog");
  });

  it("filters by direction and paginates", async () => {
    const filtered = await app.inject({
      method: "GET",
      url: `/deck?${q(NL_EN)}&limit=2`,
      cookies,
    });
    const body = filtered.json();
    expect(body.summary.total).toBe(3);
    expect(body.cards).toHaveLength(2);
  });

  it("only shows the current user's cards", async () => {
    const other = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "other@example.com", password: "another password" },
    });
    const otherCookies = { session: other.cookies.find((c) => c.name === "session")!.value };
    const res = await app.inject({ method: "GET", url: "/deck", cookies: otherCookies });
    expect(res.json().summary.total).toBe(0);
    expect(res.json().cards).toEqual([]);
  });
});

describe("GET /concepts/search", () => {
  const search = (params: Record<string, string>, withCookies = false) =>
    app.inject({
      method: "GET",
      url: `/concepts/search?${q({ ...EN_NL, ...params })}`,
      ...(withCookies ? { cookies } : {}),
    });
  const lemmas = (body: { concepts: { entries: { lemma: string }[] }[] }) =>
    body.concepts.map((c) => c.entries.map((e) => e.lemma).join("/"));

  it("finds words by either language, and only ones usable in the direction", async () => {
    expect(lemmas((await search({ q: "hond" })).json())).toEqual(["dog/hond"]);
    expect(lemmas((await search({ q: "HOUSE" })).json())).toEqual(["house/huis"]);
    // "orphan" has no Dutch entry, so it cannot become a card.
    expect((await search({ q: "orphan" })).json().concepts).toEqual([]);
  });

  it("puts exact matches before prefix matches before substring matches", async () => {
    // "o" is inside both words; the shorter one comes first.
    expect(lemmas((await search({ q: "o" })).json())).toEqual(["dog/hond", "house/huis"]);
  });

  it("treats % and _ literally", async () => {
    expect((await search({ q: "%" })).json().concepts).toEqual([]);
    expect((await search({ q: "_" })).json().concepts).toEqual([]);
  });

  it("pages with offset and reports whether more exist", async () => {
    const first = (await search({ q: "o", limit: "1" })).json();
    expect(lemmas(first)).toEqual(["dog/hond"]);
    expect(first.hasMore).toBe(true);
    const second = (await search({ q: "o", limit: "1", offset: "1" })).json();
    expect(lemmas(second)).toEqual(["house/huis"]);
    expect(second.hasMore).toBe(false);
  });

  it("reports deck status for a signed-in user, and can hide what they have", async () => {
    const anon = (await search({ q: "hond" })).json();
    expect(anon.concepts[0].inDeck).toBeUndefined();

    const mine = (await search({ q: "hond" }, true)).json();
    expect(mine.concepts[0].inDeck).toBe(true);

    const hidden = (await search({ q: "hond", hideInDeck: "1" }, true)).json();
    expect(hidden.concepts).toEqual([]);
    // Anonymous visitors have no deck to hide from.
    expect((await search({ q: "hond", hideInDeck: "1" })).json().concepts).toHaveLength(1);
  });

  it("rejects a missing term and the same language on both sides", async () => {
    expect((await search({ q: "" })).statusCode).toBe(400);
    const same = await app.inject({
      method: "GET",
      url: `/concepts/search?${q({ q: "dog", fromLanguage: "en", toLanguage: "en" })}`,
    });
    expect(same.statusCode).toBe(400);
  });
});
