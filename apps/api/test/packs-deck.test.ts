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
    expect(plain.json().packs[0]).toMatchObject({ slug: "sample", conceptCount: 4, category: "topic" });
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

describe("adding in both directions", () => {
  let both: { session: string };
  let conceptIds: string[];

  const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload, cookies: both });
  const deckCards = async () =>
    (await app.inject({ method: "GET", url: "/deck?limit=100", cookies: both })).json().cards as {
      conceptId: string;
      fromLanguage: string;
    }[];

  beforeAll(async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "both@example.com", password: "correct horse battery" },
    });
    both = { session: reg.cookies.find((c) => c.name === "session")!.value };
    const detail = await app.inject({ method: "GET", url: `/packs/${packId}?${q(EN_NL)}` });
    conceptIds = detail.json().concepts.map((c: { conceptId: string }) => c.conceptId);
  });

  it("adds a whole pack both ways, counting cards", async () => {
    const res = await post(`/packs/${packId}/add`, { ...EN_NL, bothDirections: true });
    expect(res.statusCode).toBe(200);
    // Three words are available, so six cards; one word cannot be added.
    expect(res.json()).toEqual({ added: 6, alreadyInDeck: 0, unavailable: 1 });
    const cards = await deckCards();
    expect(cards.filter((c) => c.fromLanguage === "en")).toHaveLength(3);
    expect(cards.filter((c) => c.fromLanguage === "nl")).toHaveLength(3);
  });

  it("studies all the forward cards before any reverse card, however quickly they were added", async () => {
    const { rows } = await pg.query<{ from_language: string; first: string; last: string }>(
      `select c.from_language, min(c.added_at) as first, max(c.added_at) as last
       from user_cards c join users u on u.id = c.user_id
       where u.email = 'both@example.com' group by c.from_language`,
    );
    const en = rows.find((r) => r.from_language === "en")!;
    const nl = rows.find((r) => r.from_language === "nl")!;
    expect(new Date(en.last).getTime()).toBeLessThan(new Date(nl.first).getTime());
  });

  it("is idempotent", async () => {
    const res = await post(`/packs/${packId}/add`, { ...EN_NL, bothDirections: true });
    expect(res.json()).toEqual({ added: 0, alreadyInDeck: 6, unavailable: 1 });
  });

  it("only adds the direction that is missing", async () => {
    // A word that has just one of its two cards gets the other.
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "half@example.com", password: "correct horse battery" },
    });
    const half = { session: reg.cookies.find((c) => c.name === "session")!.value };
    await app.inject({ method: "POST", url: `/concepts/${conceptIds[0]}/add`, payload: NL_EN, cookies: half });
    const res = await app.inject({
      method: "POST",
      url: `/packs/${packId}/add`,
      payload: { ...EN_NL, bothDirections: true },
      cookies: half,
    });
    expect(res.json()).toEqual({ added: 5, alreadyInDeck: 1, unavailable: 1 });
  });

  it("adds a single word both ways", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "single@example.com", password: "correct horse battery" },
    });
    const single = { session: reg.cookies.find((c) => c.name === "session")!.value };
    const url = `/concepts/${conceptIds[1]}/add`;
    const first = await app.inject({ method: "POST", url, payload: { ...EN_NL, bothDirections: true }, cookies: single });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({ added: 2, alreadyInDeck: 0 });
    const again = await app.inject({ method: "POST", url, payload: { ...EN_NL, bothDirections: true }, cookies: single });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ added: 0, alreadyInDeck: 2 });
  });

  it("still adds just one direction when not asked for both", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "one@example.com", password: "correct horse battery" },
    });
    const one = { session: reg.cookies.find((c) => c.name === "session")!.value };
    const res = await app.inject({
      method: "POST",
      url: `/concepts/${conceptIds[2]}/add`,
      payload: EN_NL,
      cookies: one,
    });
    expect(res.json()).toEqual({ added: 1, alreadyInDeck: 0 });
  });

  it("rejects a bothDirections that is not a boolean", async () => {
    const res = await post(`/packs/${packId}/add`, { ...EN_NL, bothDirections: "yes" });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /concepts/:id", () => {
  let conceptId: string;
  beforeAll(async () => {
    const detail = await app.inject({ method: "GET", url: `/packs/${packId}?${q(EN_NL)}` });
    conceptId = detail.json().concepts[0].conceptId;
  });

  it("is public, and returns both sides of the word in the direction asked for", async () => {
    const res = await app.inject({ method: "GET", url: `/concepts/${conceptId}?${q(EN_NL)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.conceptId).toBe(conceptId);
    expect(body.front.every((e: { language: string }) => e.language === "en")).toBe(true);
    expect(body.back.every((e: { language: string }) => e.language === "nl")).toBe(true);
    expect(body.front.length).toBeGreaterThan(0);
    expect(body.back.length).toBeGreaterThan(0);
    expect(Array.isArray(body.sentences.front)).toBe(true);
    expect(Array.isArray(body.sentences.back)).toBe(true);
  });

  it("swaps the sides for the other direction", async () => {
    const forward = (await app.inject({ method: "GET", url: `/concepts/${conceptId}?${q(EN_NL)}` })).json();
    const reverse = (await app.inject({ method: "GET", url: `/concepts/${conceptId}?${q(NL_EN)}` })).json();
    expect(reverse.front).toEqual(forward.back);
    expect(reverse.back).toEqual(forward.front);
  });

  it("works for a word that has no Dutch entry yet, with an empty back", async () => {
    const res = await app.inject({ method: "GET", url: `/concepts/${orphanConceptId}?${q(EN_NL)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().front).toHaveLength(1);
    expect(res.json().back).toEqual([]);
  });

  it("needs a direction, and 404s for an unknown word", async () => {
    expect((await app.inject({ method: "GET", url: `/concepts/${conceptId}` })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: `/concepts/${conceptId}?${q({ fromLanguage: "en", toLanguage: "en" })}` })).statusCode,
    ).toBe(400);
    expect((await app.inject({ method: "GET", url: `/concepts/nope?${q(EN_NL)}` })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: `/concepts/00000000-0000-4000-8000-000000000000?${q(EN_NL)}` })).statusCode,
    ).toBe(404);
  });

  it("does not get in the way of word search", async () => {
    const res = await app.inject({ method: "GET", url: `/concepts/search?q=dog&${q(EN_NL)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().concepts).toBeDefined();
  });
});

describe("packs that teach one language", () => {
  const slugs = async (url: string) =>
    ((await app.inject({ method: "GET", url })).json().packs as { slug: string }[]).map((p) => p.slug).sort();

  beforeAll(async () => {
    await pg.query(`insert into languages (code, name) values ('fr', 'Français') on conflict do nothing`);
    for (const [slug, target] of [
      ["for-dutch", "nl"],
      ["for-english", "en"],
      ["for-french", "fr"],
    ] as const) {
      await pg.query(`insert into packs (slug, name, category, target) values ($1, $1, 'topic', $2)`, [slug, target]);
    }
  });

  it("lists every pack when no direction is asked for, with the language each teaches", async () => {
    expect(await slugs("/packs")).toEqual(["for-dutch", "for-english", "for-french", "sample"]);
    const all = (await app.inject({ method: "GET", url: "/packs" })).json().packs as { slug: string; target: string | null }[];
    expect(Object.fromEntries(all.map((p) => [p.slug, p.target]))).toEqual({
      sample: null,
      "for-dutch": "nl",
      "for-english": "en",
      "for-french": "fr",
    });
  });

  it("lists the packs for the language being learned, which is the direction's `to`", async () => {
    // Learning Dutch from English: the Dutch packs, not the English ones.
    expect(await slugs(`/packs?${q(EN_NL)}`)).toEqual(["for-dutch", "sample"]);
    // Learning English from Dutch: the other way round.
    expect(await slugs(`/packs?${q(NL_EN)}`)).toEqual(["for-english", "sample"]);
  });

  it("still lets a pack for any language through", async () => {
    expect(await slugs(`/packs?${q(EN_NL)}`)).toContain("sample");
    expect(await slugs(`/packs?${q(NL_EN)}`)).toContain("sample");
  });

  it("does not hide a pack from someone who opens it directly", async () => {
    const list = (await app.inject({ method: "GET", url: "/packs" })).json().packs as { id: string; slug: string }[];
    const french = list.find((p) => p.slug === "for-french")!;
    const res = await app.inject({ method: "GET", url: `/packs/${french.id}` });
    expect(res.statusCode).toBe(200);
  });
});

describe("pack names and descriptions in the learner's language", () => {
  let samplePack: { id: string; name: string; description: string | null };
  const list = async (query: string) =>
    (await app.inject({ method: "GET", url: `/packs?${query}` })).json().packs as { id: string; slug: string; name: string; description: string | null }[];

  beforeAll(async () => {
    const all = (await app.inject({ method: "GET", url: "/packs" })).json().packs as typeof samplePack[] & { slug: string }[];
    samplePack = all.find((p) => (p as unknown as { slug: string }).slug === "sample")!;
    await pg.query(`insert into languages (code, name) values ('fr', 'Français') on conflict do nothing`);
    await pg.query(`insert into pack_texts (pack_id, language, name, description) values ($1, 'nl', 'Voorbeeldpakket', 'Een demo')`, [samplePack.id]);
    await pg.query(`insert into pack_texts (pack_id, language, name, description) values ($1, 'fr', 'Paquet d''exemple', null)`, [samplePack.id]);
  });

  const sample = async (query: string) => (await list(query)).find((p) => p.slug === "sample")!;

  it("uses the text in the pack file when no direction is given", async () => {
    expect(await sample("")).toMatchObject({ name: samplePack.name, description: samplePack.description });
  });

  it("uses the text in the language the learner reads, which is the direction's `from`", async () => {
    // Reading Dutch, learning English.
    expect(await sample(q(NL_EN))).toMatchObject({ name: "Voorbeeldpakket", description: "Een demo" });
  });

  it("uses the pack file's text for a language that has none", async () => {
    // Reading English: that is what the pack file is written in.
    expect(await sample(q(EN_NL))).toMatchObject({ name: samplePack.name, description: samplePack.description });
  });

  it("gives no description, not another language's, when a translation has a name only", async () => {
    await pg.query(`insert into packs (slug, name, description, category) values ('name-only', 'Name only', 'English description', 'topic')`);
    const [row] = (await pg.query<{ id: string }>(`select id from packs where slug = 'name-only'`)).rows;
    await pg.query(`insert into pack_texts (pack_id, language, name) values ($1, 'nl', 'Alleen een naam')`, [row!.id]);
    const find = async (query: string) => (await list(query)).find((p) => p.slug === "name-only")!;
    expect(await find(q(NL_EN))).toMatchObject({ name: "Alleen een naam", description: null });
    expect(await find(q(EN_NL))).toMatchObject({ name: "Name only", description: "English description" });
  });

  it("sorts packs by the name the learner sees", async () => {
    await pg.query(`insert into packs (slug, name, category) values ('zebra-pack', 'Zebra', 'topic')`);
    const [zebra] = (await pg.query<{ id: string }>(`select id from packs where slug = 'zebra-pack'`)).rows;
    await pg.query(`insert into pack_texts (pack_id, language, name) values ($1, 'nl', 'Aap')`, [zebra!.id]);
    const names = (await list(q(NL_EN))).map((p) => p.name);
    expect(names.indexOf("Aap")).toBeLessThan(names.indexOf("Voorbeeldpakket"));
    const english = (await list(q(EN_NL))).map((p) => p.name);
    expect(english.indexOf("Zebra")).toBeGreaterThan(english.indexOf(samplePack.name));
  });

  it("gives the translated name and description on the pack's own page too", async () => {
    const res = await app.inject({ method: "GET", url: `/packs/${samplePack.id}?${q(NL_EN)}` });
    expect(res.json().pack).toMatchObject({ name: "Voorbeeldpakket", description: "Een demo" });
    const plain = await app.inject({ method: "GET", url: `/packs/${samplePack.id}` });
    expect(plain.json().pack).toMatchObject({ name: samplePack.name });
  });
});
