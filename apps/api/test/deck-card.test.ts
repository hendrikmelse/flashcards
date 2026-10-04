import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import * as schema from "../src/db/schema.js";
import { concepts, entries, entrySentences, sentences, userCards } from "../src/db/schema.js";

let app: FastifyInstance;
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let cookies: { session: string };
let other: { session: string };
let dogCard: string;
let reverseCard: string;
let otherCard: string;

// `null` means signed out (leaving it out means the main test user).
const get = (url: string, c: { session: string } | null = cookies) =>
  app.inject({ method: "GET", url, ...(c ? { cookies: c } : {}) });

async function register(email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "correct horse battery" },
  });
  return { id: res.json().user.id as string, cookies: { session: res.cookies.find((c) => c.name === "session")!.value } };
}

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);
  app = await buildApp({ db, logger: false });

  // Example sentences for "dog", three in English and one in Dutch.
  const dog = (await db.select().from(concepts).where(eq(concepts.key, "dog")))[0]!;
  const dogEntries = await db.select().from(entries).where(eq(entries.conceptId, dog.id));
  const give = async (language: "en" | "nl", texts: string[]) => {
    const entry = dogEntries.find((e) => e.language === language)!;
    for (const text of texts) {
      const [s] = await db.insert(sentences).values({ language, text }).returning();
      await db.insert(entrySentences).values({ entryId: entry.id, sentenceId: s!.id });
    }
  };
  await give("en", ["The dog barks.", "I walk the dog.", "A big dog."]);
  await give("nl", ["De hond blaft."]);

  const me = await register("detail@example.com");
  const them = await register("detail-other@example.com");
  cookies = me.cookies;
  other = them.cookies;
  const [forward, reverse] = await db
    .insert(userCards)
    .values([
      { userId: me.id, conceptId: dog.id, fromLanguage: "en", toLanguage: "nl", state: "review", intervalDays: 12, lapses: 2, stability: 5 },
      { userId: me.id, conceptId: dog.id, fromLanguage: "nl", toLanguage: "en" },
    ])
    .returning();
  dogCard = forward!.id;
  reverseCard = reverse!.id;
  const [theirs] = await db
    .insert(userCards)
    .values({ userId: them.id, conceptId: dog.id, fromLanguage: "en", toLanguage: "nl" })
    .returning();
  otherCard = theirs!.id;
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

describe("GET /deck/:id", () => {
  it("requires being signed in", async () => {
    expect((await get(`/deck/${dogCard}`, null)).statusCode).toBe(401);
  });

  it("returns the card with both sides' words and their forms", async () => {
    const res = await get(`/deck/${dogCard}`);
    expect(res.statusCode).toBe(200);
    const { card } = res.json();
    expect(card).toMatchObject({
      id: dogCard,
      fromLanguage: "en",
      toLanguage: "nl",
      state: "review",
    });
    expect(card.front).toHaveLength(1);
    expect(card.front[0]).toMatchObject({ language: "en", lemma: "dog" });
    expect(card.back[0]).toMatchObject({ language: "nl", lemma: "hond", details: { article: "de" } });
  });

  it("returns every example sentence for each side, in that side's language", async () => {
    const { sentences: s } = (await get(`/deck/${dogCard}`)).json();
    expect(s.front.sort()).toEqual(["A big dog.", "I walk the dog.", "The dog barks."]); // all three, not just two
    expect(s.back).toEqual(["De hond blaft."]);
  });

  it("puts the sentences on the right side for the reverse direction", async () => {
    const { card, sentences: s } = (await get(`/deck/${reverseCard}`)).json();
    expect(card).toMatchObject({ fromLanguage: "nl", toLanguage: "en", state: "new" });
    expect(s.front).toEqual(["De hond blaft."]);
    expect(s.back).toHaveLength(3);
  });

  it("says a card without sentences has none, rather than failing", async () => {
    const cats = await db.select().from(concepts).where(eq(concepts.key, "house"));
    const me = (await app.inject({ method: "GET", url: "/auth/me", cookies })).json().user.id as string;
    const [card] = await db
      .insert(userCards)
      .values({ userId: me, conceptId: cats[0]!.id, fromLanguage: "en", toLanguage: "nl" })
      .returning();
    const body = (await get(`/deck/${card!.id}`)).json();
    expect(body.sentences).toEqual({ front: [], back: [] });
    expect(body.card.front[0].lemma).toBe("house");
  });

  it("does not show another user's card", async () => {
    expect((await get(`/deck/${otherCard}`)).statusCode).toBe(404);
    expect((await get(`/deck/${dogCard}`, other)).statusCode).toBe(404);
  });

  it("404s for an unknown card and 400s for a malformed id", async () => {
    expect((await get("/deck/00000000-0000-0000-0000-000000000000")).statusCode).toBe(404);
    expect((await get("/deck/not-a-uuid")).statusCode).toBe(400);
  });

  it("describes the card the same way the deck list does", async () => {
    const list = (await get("/deck?limit=50")).json().cards as { id: string }[];
    const fromList = list.find((c) => c.id === dogCard);
    const { card } = (await get(`/deck/${dogCard}`)).json();
    expect(card).toEqual(fromList);
  });
});
