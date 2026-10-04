import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { insertUserCards } from "../src/content/queries.js";
import * as schema from "../src/db/schema.js";
import { concepts, languages, reviewLogs, userCards, users } from "../src/db/schema.js";
import { seedLanguages } from "../src/db/seed.js";

// A word is not shown both ways on the same study day if there is anything else new to show: once
// one direction has had its first look, the other goes to the back of the new cards. With nothing
// else new, it is still offered.

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
  const stamp = Date.now();
  await insertUserCards(db, userId, items, "en", "nl", new Date(stamp));
  await insertUserCards(db, userId, items, "nl", "en", new Date(stamp + 1));
}

// Both directions of the first `n` words, added one word at a time (as the Add button next to a word
// does): each word's forward and reverse cards are side by side in the order they were added.
async function addEachBothWays(userId: string, n: number) {
  const stamp = Date.now();
  for (let i = 0; i < n; i++) {
    const item = [{ conceptId: conceptIds[i]!, sortKey: 0 }];
    await insertUserCards(db, userId, item, "en", "nl", new Date(stamp + 2 * i));
    await insertUserCards(db, userId, item, "nl", "en", new Date(stamp + 2 * i + 1));
  }
}

const key = (c: Card) => `${c.conceptId}:${c.fromLanguage}>${c.toLanguage}`;
const w = (i: number, from: "en" | "nl") => `${conceptIds[i]}:${from}>${from === "en" ? "nl" : "en"}`;

const sessionOf = (cookies: { session: string }) => async (query = "") =>
  (await app.inject({ method: "GET", url: `/study?limit=100${query}`, cookies })).json() as { cards: Card[]; counts: { new: number } };
const newOrder = (cookies: { session: string }) => async (query = "") =>
  (await sessionOf(cookies)(query)).cards.filter((c) => c.state === "new").map(key);
const countsOf = (cookies: { session: string }) => async () =>
  (await app.inject({ method: "GET", url: "/study/counts", cookies })).json() as { counts: { new: number }; tomorrow: number };
const answer = (cookies: { session: string }, card: { id: string }, rating = "good") =>
  app.inject({
    method: "POST",
    url: "/reviews",
    payload: { userCardId: card.id, clientReviewId: crypto.randomUUID(), rating },
    cookies,
  });
const first = (cards: Card[], from: "en" | "nl", conceptIndex: number) =>
  cards.find((c) => c.fromLanguage === from && c.conceptId === conceptIds[conceptIndex])!;
const longAgo = (userId: string) =>
  db
    .update(reviewLogs)
    .set({ reviewedAt: new Date(Date.now() - 3 * 24 * 3_600_000) })
    .where(eq(reviewLogs.userId, userId));

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
  it("comes after the other new cards", async () => {
    const u = await newUser("after@example.com");
    await addBothWays(u.id, 2);
    const order = newOrder(u.cookies);
    // To begin with, the cards come in the order they were added: forward ones, then reverse ones.
    expect(await order()).toEqual([w(0, "en"), w(1, "en"), w(0, "nl"), w(1, "nl")]);

    await answer(u.cookies, first((await sessionOf(u.cookies)()).cards, "en", 0));
    // Word 0 has been shown, so its reverse goes last, behind word 1's cards.
    expect(await order()).toEqual([w(1, "en"), w(1, "nl"), w(0, "nl")]);
  });

  it("is still offered when there is nothing else new, and counts as available", async () => {
    const u = await newUser("alone@example.com");
    await addBothWays(u.id, 1);
    const forward = first((await sessionOf(u.cookies)()).cards, "en", 0);
    await answer(u.cookies, forward);

    expect(await newOrder(u.cookies)()).toEqual([w(0, "nl")]);
    expect((await countsOf(u.cookies)()).counts.new).toBe(1);
  });

  it("still counts against the daily limit like any other new card", async () => {
    const u = await newUser("limit@example.com");
    await addBothWays(u.id, 1);
    await db.update(users).set({ dailyNewCardLimit: 1 }).where(eq(users.id, u.id));
    // The one new card allowed today is used up by a word that needed learning (Again).
    await answer(u.cookies, first((await sessionOf(u.cookies)()).cards, "en", 0), "again");
    expect((await countsOf(u.cookies)()).counts.new).toBe(0);
    expect(await newOrder(u.cookies)()).toEqual([]);
  });

  it("goes back to its place the next day", async () => {
    const u = await newUser("next-day@example.com");
    await addBothWays(u.id, 2);
    await answer(u.cookies, first((await sessionOf(u.cookies)()).cards, "en", 0));
    expect((await newOrder(u.cookies)())[0]).toBe(w(1, "en"));

    // The first look was yesterday, as far as the study day goes: nothing is held to the back now.
    await longAgo(u.id);
    expect(await newOrder(u.cookies)()).toEqual([w(1, "en"), w(0, "nl"), w(1, "nl")]);
  });

  it("works from whichever direction the word was first shown, and whatever the first answer was", async () => {
    const u = await newUser("either@example.com");
    await addBothWays(u.id, 3);
    const cards = (await sessionOf(u.cookies)()).cards;
    await answer(u.cookies, first(cards, "nl", 0), "easy");
    await answer(u.cookies, first(cards, "en", 1), "again");

    const order = await newOrder(u.cookies)();
    // Word 2 has not been shown, so both of its cards come before the other directions of words 0 and 1.
    expect(order.slice(0, 2).sort()).toEqual([w(2, "en"), w(2, "nl")].sort());
    expect(order.slice(2).sort()).toEqual([w(0, "en"), w(1, "nl")].sort());
  });

  it("leaves other people's cards alone", async () => {
    const a = await newUser("others-a@example.com");
    const b = await newUser("others-b@example.com");
    await addBothWays(a.id, 2);
    await addBothWays(b.id, 2);
    await answer(a.cookies, first((await sessionOf(a.cookies)()).cards, "en", 0));
    // B has shown nothing, so keeps the order the cards were added in.
    expect(await newOrder(b.cookies)()).toEqual([w(0, "en"), w(1, "en"), w(0, "nl"), w(1, "nl")]);
  });

  it("is not moved back by cards that were only added, not shown", async () => {
    const u = await newUser("added-only@example.com");
    await addBothWays(u.id, 2);
    expect(await newOrder(u.cookies)()).toEqual([w(0, "en"), w(1, "en"), w(0, "nl"), w(1, "nl")]);
  });

  it("is not moved back by a first look at the same word in another language pair", async () => {
    await db.insert(languages).values({ code: "fr", name: "Français" }).onConflictDoNothing();
    const u = await newUser("other-pair@example.com");
    await addBothWays(u.id, 2);
    await insertUserCards(db, u.id, [{ conceptId: conceptIds[0]!, sortKey: 0 }], "en", "fr");
    const [french] = await db
      .select()
      .from(userCards)
      .where(and(eq(userCards.userId, u.id), eq(userCards.toLanguage, "fr")));
    await answer(u.cookies, french!);

    // English to French was shown: that does not touch the Dutch cards of the same word.
    expect(await newOrder(u.cookies)("&pair=en-nl")).toEqual([w(0, "en"), w(1, "en"), w(0, "nl"), w(1, "nl")]);
  });

  it("is not moved back by a card that was reviewed again, only by a first look", async () => {
    const u = await newUser("again@example.com");
    await addBothWays(u.id, 2);
    const forward = first((await sessionOf(u.cookies)()).cards, "en", 0);
    await answer(u.cookies, forward);
    await longAgo(u.id); // the first look was long ago
    await db.update(userCards).set({ state: "review", dueAt: new Date(Date.now() - 60_000) }).where(eq(userCards.id, forward.id));
    const due = (await sessionOf(u.cookies)()).cards.find((c) => c.id === forward.id)!;
    await answer(u.cookies, due); // shown again today, but not for the first time

    // Word 0 is now in review, so its reverse goes to the front (the usual rule), not the back.
    expect(await newOrder(u.cookies)()).toEqual([w(0, "nl"), w(1, "en"), w(1, "nl")]);
  });

  describe("when words were added one at a time, so neither direction has been shown yet", () => {
    it("offers a different word's card before a word's second direction", async () => {
      const u = await newUser("single-order@example.com");
      await addEachBothWays(u.id, 3);
      expect(await newOrder(u.cookies)()).toEqual([w(0, "en"), w(1, "en"), w(2, "en"), w(0, "nl"), w(1, "nl"), w(2, "nl")]);
    });

    it("does not put a word's two directions in one session when the daily limit leaves room for only some", async () => {
      const u = await newUser("single-limit@example.com");
      await addEachBothWays(u.id, 3);
      await db.update(users).set({ dailyNewCardLimit: 3 }).where(eq(users.id, u.id));
      expect(await newOrder(u.cookies)()).toEqual([w(0, "en"), w(1, "en"), w(2, "en")]);
      expect((await countsOf(u.cookies)()).counts.new).toBe(3);
    });

    it("offers both directions when it is a single word", async () => {
      const u = await newUser("single-word@example.com");
      await addEachBothWays(u.id, 1);
      expect(await newOrder(u.cookies)()).toEqual([w(0, "en"), w(0, "nl")]);
    });

    it("offers the second directions once there are no more words, up to the limit", async () => {
      const u = await newUser("single-rest@example.com");
      await addEachBothWays(u.id, 2);
      await db.update(users).set({ dailyNewCardLimit: 3 }).where(eq(users.id, u.id));
      expect(await newOrder(u.cookies)()).toEqual([w(0, "en"), w(1, "en"), w(0, "nl")]);
    });

    it("still puts a known word's other direction first, as before", async () => {
      const u = await newUser("single-known@example.com");
      await addEachBothWays(u.id, 2);
      // Word 0 is known one way (in review for a while): its other direction comes first among the new cards.
      const forward = first((await sessionOf(u.cookies)()).cards, "en", 0);
      await answer(u.cookies, forward);
      await longAgo(u.id);
      await db.update(userCards).set({ state: "review", dueAt: new Date(Date.now() + 86_400_000) }).where(eq(userCards.id, forward.id));
      const order = await newOrder(u.cookies)();
      expect(order[0]).toBe(w(0, "nl"));
    });
  });
});
