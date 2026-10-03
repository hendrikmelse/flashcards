import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { insertUserCards } from "../src/content/queries.js";
import * as schema from "../src/db/schema.js";
import { concepts, languages, userCards } from "../src/db/schema.js";
import { seedLanguages } from "../src/db/seed.js";

// Each language pair is a deck of its own. The app only supports English and Dutch so far, so a
// French deck is made directly in the database: the filters take any pair, since they only narrow
// what is already there.

let app: FastifyInstance;
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let me: { session: string };
let userId: string;
let conceptIds: string[];

const get = (url: string) => app.inject({ method: "GET", url, cookies: me });
const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload, cookies: me });

async function newUser(email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "correct horse battery" },
  });
  return { id: res.json().user.id as string, cookies: { session: res.cookies.find((c) => c.name === "session")!.value } };
}

// Gives the user `n` new cards from one language to another, using concepts from `from` on.
async function addCards(user: string, from: string, to: string, n: number, start = 0) {
  const items = conceptIds.slice(start, start + n).map((conceptId, i) => ({ conceptId, sortKey: start + i }));
  expect(await insertUserCards(db, user, items, from, to)).toBe(n);
}

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seedLanguages(db);
  await db.insert(languages).values({ code: "fr", name: "Français" });
  conceptIds = (
    await db
      .insert(concepts)
      .values(Array.from({ length: 12 }, (_, i) => ({ key: `word-${i}`, gloss: `word ${i}` })))
      .returning({ id: concepts.id })
  ).map((c) => c.id);
  app = await buildApp({ db, logger: false, authRateLimit: 1000 });
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

describe("scoping to a language pair", () => {
  beforeAll(async () => {
    const u = await newUser("pairs@example.com");
    me = u.cookies;
    userId = u.id;
    await addCards(userId, "en", "nl", 3);
    await addCards(userId, "nl", "en", 2);
    await addCards(userId, "en", "fr", 4);
    await addCards(userId, "fr", "en", 1);
  });

  const total = async (query: string) => (await get(`/deck?limit=1${query}`)).json().summary.total as number;

  it("covers every deck when no pair is given", async () => {
    expect(await total("")).toBe(10);
  });

  it("covers both directions of a pair, whichever way round it is written", async () => {
    expect(await total("&pair=en-nl")).toBe(5);
    expect(await total("&pair=nl-en")).toBe(5);
    expect(await total("&pair=en-fr")).toBe(5);
    expect(await total("&pair=fr-en")).toBe(5);
  });

  it("matches nothing for a pair the user has no cards in", async () => {
    expect(await total("&pair=fr-nl")).toBe(0);
    expect(await total("&pair=de-es")).toBe(0);
  });

  it("narrows to one direction within the pair", async () => {
    expect(await total("&pair=en-nl&fromLanguage=en&toLanguage=nl")).toBe(3);
    expect(await total("&pair=en-nl&fromLanguage=nl&toLanguage=en")).toBe(2);
  });

  it("lists only the cards of the pair", async () => {
    const res = await get("/deck?limit=50&pair=en-fr");
    const cards = res.json().cards as { fromLanguage: string; toLanguage: string }[];
    expect(cards).toHaveLength(5);
    expect(cards.every((c) => [c.fromLanguage, c.toLanguage].sort().join("-") === "en-fr")).toBe(true);
  });

  it("counts what is ready to study in the pair only", async () => {
    const counts = async (pair: string) => (await get(`/study/counts?pair=${pair}`)).json().counts;
    expect(await counts("en-nl")).toEqual({ learning: 0, review: 0, new: 5 });
    expect(await counts("en-fr")).toEqual({ learning: 0, review: 0, new: 5 });
    expect(await counts("fr-nl")).toEqual({ learning: 0, review: 0, new: 0 });
    expect((await get("/study/counts")).json().counts.new).toBe(10);
  });

  it("offers cards of the pair only in a session", async () => {
    const res = await get("/study?limit=50&pair=en-fr");
    const cards = res.json().cards as { fromLanguage: string; toLanguage: string }[];
    expect(cards).toHaveLength(5);
    expect(cards.every((c) => [c.fromLanguage, c.toLanguage].includes("fr"))).toBe(true);
  });

  it("breaks down the deck of the pair only, in the stats", async () => {
    const stats = (await get("/stats?pair=en-nl")).json();
    expect(stats.directions.map((d: { fromLanguage: string; toLanguage: string }) => `${d.fromLanguage}>${d.toLanguage}`)).toEqual([
      "en>nl",
      "nl>en",
    ]);
    const all = (await get("/stats")).json();
    expect(all.directions).toHaveLength(4);
  });

  it("rejects a pair that is not written as two codes, or a direction outside it", async () => {
    for (const query of ["pair=english", "pair=en", "pair=en-en", "pair=en-nl&fromLanguage=en&toLanguage=en", "pair=en-nl&fromLanguage=nl"]) {
      expect((await get(`/deck?${query}`)).statusCode, query).toBe(400);
    }
    expect((await get("/study/counts?pair=nope")).statusCode).toBe(400);
    expect((await get("/stats?pair=nope")).statusCode).toBe(400);
  });
});

describe("decks do not share a daily limit or a session gap", () => {
  const counts = async (query = "") => (await get(`/study/counts${query}`)).json();

  beforeAll(async () => {
    const u = await newUser("separate@example.com");
    me = u.cookies;
    userId = u.id;
    await addCards(userId, "en", "nl", 3);
    await addCards(userId, "en", "fr", 3, 3);
    // One English to French card that is already being learned and is due.
    const [learning] = await db.select().from(userCards).where(eq(userCards.userId, userId));
    expect(learning).toBeDefined();
    await addCards(userId, "en", "fr", 1, 8);
    const [frLearning] = await db
      .select()
      .from(userCards)
      .where(eq(userCards.conceptId, conceptIds[8]!));
    await db
      .update(userCards)
      .set({ state: "learning", dueAt: new Date(Date.now() - 60_000) })
      .where(eq(userCards.id, frLearning!.id));
    expect((await patchLimit(1)).statusCode).toBe(200);
  });

  const patchLimit = (dailyNewCardLimit: number) =>
    app.inject({ method: "PATCH", url: "/settings", payload: { dailyNewCardLimit }, cookies: me });

  it("lets each pair introduce its own new cards each day", async () => {
    expect((await counts("?pair=en-nl")).counts.new).toBe(1);
    expect((await counts("?pair=en-fr")).counts.new).toBe(1);

    // Meeting a new English to Dutch card, and finding it hard, uses up that deck's limit...
    const dutch = (await get("/study?limit=10&pair=en-nl")).json().cards[0];
    const answered = await post("/reviews", {
      userCardId: dutch.id,
      clientReviewId: crypto.randomUUID(),
      rating: "again",
    });
    expect(answered.statusCode).toBe(200);
    expect((await counts("?pair=en-nl")).counts.new).toBe(0);
    // ...and leaves the French deck's alone.
    expect((await counts("?pair=en-fr")).counts.new).toBe(1);
  });

  it("does not hold back one pair's learning cards because of a session in another", async () => {
    // The Dutch card is now being learned and, as the last answer was moments ago, held back.
    const dutch = await counts("?pair=en-nl");
    expect(dutch.counts.learning).toBe(0);
    expect(dutch.nextSession).not.toBeNull();
    // The French deck had no session: its learning card is ready now.
    const french = await counts("?pair=en-fr");
    expect(french.counts.learning).toBe(1);
    expect(french.nextSession).toBeNull();
  });

  it("treats every deck as one when no pair is given", async () => {
    const all = await counts();
    expect(all.counts.learning).toBe(0); // held back by the Dutch session
    expect(all.nextSession).not.toBeNull();
  });

  it("counts a day's reviews in the pair only", async () => {
    expect((await get("/stats?pair=en-nl")).json().reviewsToday).toBe(1);
    expect((await get("/stats?pair=en-fr")).json().reviewsToday).toBe(0);
    expect((await get("/stats")).json().reviewsToday).toBe(1);
  });
});
