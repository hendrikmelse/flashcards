import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { insertUserCards } from "../src/content/queries.js";
import * as schema from "../src/db/schema.js";
import { concepts, languages, reviewLogs, userCards } from "../src/db/schema.js";
import { seedLanguages } from "../src/db/seed.js";

// A word is not shown both ways on the same study day: once one direction has had its first look,
// the other waits until the next day.

let app: FastifyInstance;
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let conceptIds: string[];

type Card = { id: string; conceptId: string; fromLanguage: string; toLanguage: string; state: string };

async function newUser(email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "correct horse battery" },
  });
  return {
    id: res.json().user.id as string,
    cookies: { session: res.cookies.find((c) => c.name === "session")!.value },
  };
}

// Both directions of the first `n` words, as adding a pack does: all forward cards, then all reverse.
async function addBothWays(userId: string, n: number) {
  const items = conceptIds.slice(0, n).map((conceptId, i) => ({ conceptId, sortKey: i }));
  await insertUserCards(db, userId, items, "en", "nl");
  await insertUserCards(db, userId, items, "nl", "en");
}

const sessionOf = (cookies: { session: string }) => async (query = "") =>
  (await app.inject({ method: "GET", url: `/study?limit=100${query}`, cookies })).json() as { cards: Card[]; counts: { new: number } };
const countsOf = (cookies: { session: string }) => async () =>
  (await app.inject({ method: "GET", url: "/study/counts", cookies })).json() as { counts: { new: number }; tomorrow: number };
const answer = (cookies: { session: string }, card: Card, rating = "good") =>
  app.inject({
    method: "POST",
    url: "/reviews",
    payload: { userCardId: card.id, clientReviewId: crypto.randomUUID(), rating },
    cookies,
  });
const key = (c: Card) => `${c.conceptId}:${c.fromLanguage}>${c.toLanguage}`;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seedLanguages(db);
  conceptIds = (
    await db
      .insert(concepts)
      .values(Array.from({ length: 6 }, (_, i) => ({ key: `word-${i}`, gloss: `word ${i}` })))
      .returning({ id: concepts.id })
  ).map((c) => c.id);
  app = await buildApp({ db, logger: false, authRateLimit: 1000 });
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

describe("a new card whose reverse was first shown today", () => {
  it("is held back until the next study day, and does not count as available today", async () => {
    const u = await newUser("held@example.com");
    await addBothWays(u.id, 1);
    const study = sessionOf(u.cookies);
    const counts = countsOf(u.cookies);

    // Both directions are on offer to begin with.
    expect((await study()).cards).toHaveLength(2);
    expect((await counts()).counts.new).toBe(2);

    const forward = (await study()).cards.find((c) => c.fromLanguage === "en")!;
    expect((await answer(u.cookies, forward)).statusCode).toBe(200);

    // The reverse waits, though it is still a new card.
    const after = await study();
    expect(after.cards.some((c) => key(c) === `${forward.conceptId}:nl>en`)).toBe(false);
    expect((await counts()).counts.new).toBe(0);
    expect(after.counts.new).toBe(0);

    // Studying just that direction finds nothing new either.
    expect((await study("&fromLanguage=nl&toLanguage=en")).cards).toHaveLength(0);
  });

  it("comes back the next day, and is counted in what will be waiting tomorrow", async () => {
    const u = await newUser("tomorrow@example.com");
    await addBothWays(u.id, 1);
    const forward = (await sessionOf(u.cookies)()).cards.find((c) => c.fromLanguage === "en")!;
    await answer(u.cookies, forward);
    expect((await countsOf(u.cookies)()).counts.new).toBe(0);
    // Tomorrow's count includes the card that is being held, as new cards then.
    expect((await countsOf(u.cookies)()).tomorrow).toBeGreaterThanOrEqual(1);

    // The first look was yesterday, as far as the study day goes.
    await db
      .update(reviewLogs)
      .set({ reviewedAt: new Date(Date.now() - 3 * 24 * 3_600_000) })
      .where(eq(reviewLogs.userId, u.id));
    const next = await sessionOf(u.cookies)();
    expect(next.cards.map(key)).toContain(`${forward.conceptId}:nl>en`);
    expect((await countsOf(u.cookies)()).counts.new).toBe(1);
  });

  it("is held whatever the first answer was, and from whichever direction the word was first shown", async () => {
    const u = await newUser("either@example.com");
    await addBothWays(u.id, 2);
    const cards = (await sessionOf(u.cookies)()).cards;
    const dutchFirst = cards.find((c) => c.fromLanguage === "nl" && c.conceptId === conceptIds[0])!;
    await answer(u.cookies, dutchFirst, "easy");
    const again = cards.find((c) => c.fromLanguage === "en" && c.conceptId === conceptIds[1])!;
    await answer(u.cookies, again, "again");

    const keys = (await sessionOf(u.cookies)()).cards.map(key);
    // Neither of the words that were shown has its other direction on offer.
    expect(keys).not.toContain(`${conceptIds[0]}:en>nl`);
    expect(keys).not.toContain(`${conceptIds[1]}:nl>en`);
  });

  it("does not hold back other words, or the cards of someone else", async () => {
    const a = await newUser("others-a@example.com");
    const b = await newUser("others-b@example.com");
    await addBothWays(a.id, 3);
    await addBothWays(b.id, 3);
    const first = (await sessionOf(a.cookies)()).cards.find((c) => c.fromLanguage === "en")!;
    await answer(a.cookies, first);

    const forA = (await sessionOf(a.cookies)()).cards;
    // Four new cards of six are left on offer to A (the card shown is gone, and its reverse is held)...
    expect(forA.filter((c) => c.state === "new")).toHaveLength(4);
    expect(forA.map(key)).not.toContain(`${first.conceptId}:nl>en`);
    // ...and B, who has shown nothing, still has all six.
    expect((await sessionOf(b.cookies)()).cards.filter((c) => c.state === "new")).toHaveLength(6);
  });

  it("is not held back by cards that were only added, not shown", async () => {
    const u = await newUser("added-only@example.com");
    await addBothWays(u.id, 1);
    expect((await countsOf(u.cookies)()).counts.new).toBe(2);
    expect((await sessionOf(u.cookies)()).cards).toHaveLength(2);
  });

  it("is not held back by a first look at the same word in another language pair", async () => {
    await db.insert(languages).values({ code: "fr", name: "Français" }).onConflictDoNothing();
    const u = await newUser("other-pair@example.com");
    await addBothWays(u.id, 1);
    await insertUserCards(db, u.id, [{ conceptId: conceptIds[0]!, sortKey: 0 }], "en", "fr");
    const [french] = await db
      .select()
      .from(userCards)
      .where(and(eq(userCards.userId, u.id), eq(userCards.toLanguage, "fr")));
    await answer(u.cookies, { id: french!.id } as Card);

    // English to French was shown, and its reverse would be French to English: the Dutch cards of the
    // word are a different deck and are all still on offer.
    const keys = (await sessionOf(u.cookies)("&pair=en-nl")).cards.map(key);
    expect(keys.sort()).toEqual([`${conceptIds[0]}:en>nl`, `${conceptIds[0]}:nl>en`].sort());
  });

  it("only holds it for a card shown for the first time, not one that was reviewed again", async () => {
    const u = await newUser("again@example.com");
    await addBothWays(u.id, 1);
    const forward = (await sessionOf(u.cookies)()).cards.find((c) => c.fromLanguage === "en")!;
    await answer(u.cookies, forward);
    // The first look was long ago, and the forward card is shown again today (not a first look).
    await db
      .update(reviewLogs)
      .set({ reviewedAt: new Date(Date.now() - 3 * 24 * 3_600_000) })
      .where(eq(reviewLogs.userId, u.id));
    await db.update(userCards).set({ state: "review", dueAt: new Date(Date.now() - 60_000) }).where(eq(userCards.id, forward.id));
    const review = (await sessionOf(u.cookies)()).cards.find((c) => c.id === forward.id)!;
    expect(review).toBeDefined();
    await answer(u.cookies, review);
    // A repeat look today does not hold the reverse back: it was due already.
    expect((await sessionOf(u.cookies)()).cards.map(key)).toContain(`${forward.conceptId}:nl>en`);
  });
});
