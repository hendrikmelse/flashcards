import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFsrsScheduler } from "../src/srs/engine.js";
import { seed } from "../src/db/seed.js";
import * as schema from "../src/db/schema.js";
import {
  concepts,
  entries,
  entrySentences,
  reviewLogs,
  sentences,
  userCards,
  users,
} from "../src/db/schema.js";

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;
let app: FastifyInstance;
let pg: PGlite;
let cookies: { session: string };
let userId: string;

type Card = {
  id: string;
  state: string;
  front: { lemma: string }[];
  sentences: { front: string[]; back: string[] };
};

const get = async (url: string, c = cookies) =>
  app.inject({ method: "GET", url, cookies: c });
const study = async () => (await get("/study")).json() as {
  counts: { learning: number; review: number; new: number };
  cards: Card[];
};
const review = (
  userCardId: string,
  rating: string,
  extra: Record<string, unknown> = {},
  c = cookies,
) =>
  app.inject({
    method: "POST",
    url: "/reviews",
    cookies: c,
    payload: { userCardId, rating, clientReviewId: randomUUID(), ...extra },
  });

async function register(email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "correct horse battery" },
  });
  return {
    cookies: { session: res.cookies.find((c) => c.name === "session")!.value },
    id: res.json().user.id as string,
  };
}

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);

  // Example sentences for "dog" in both languages.
  const dogEntries = await db.select().from(entries);
  for (const [language, text] of [
    ["en", "The dog barks."],
    ["nl", "De hond blaft."],
  ] as const) {
    const entry = dogEntries.find((e) => e.language === language && e.lemma === (language === "en" ? "dog" : "hond"))!;
    const [s] = await db.insert(sentences).values({ language, text }).returning();
    await db.insert(entrySentences).values({ entryId: entry.id, sentenceId: s!.id });
  }

  app = await buildApp({ db, logger: false, scheduler: createFsrsScheduler({ fuzz: false }) });

  const me = await register("learner@example.com");
  cookies = me.cookies;
  userId = me.id;

  const packs = await app.inject({ method: "GET", url: "/packs" });
  await app.inject({
    method: "POST",
    url: `/packs/${packs.json().packs[0].id}/add`,
    cookies,
    payload: { fromLanguage: "en", toLanguage: "nl" },
  });
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

const setLimit = (n: number) =>
  db.update(users).set({ dailyNewCardLimit: n }).where(eq(users.id, userId));

describe("GET /study", () => {
  it("requires authentication", async () => {
    expect((await app.inject({ method: "GET", url: "/study" })).statusCode).toBe(401);
  });

  it("offers new cards with entries and example sentences", async () => {
    const { counts, cards } = await study();
    expect(counts).toEqual({ learning: 0, review: 0, new: 3 });
    expect(cards).toHaveLength(3);
    // New cards come in pack order.
    expect(cards.map((c) => c.front[0]?.lemma)).toEqual(["dog", "house", "water"]);
    const dog = cards.find((c) => c.front[0]?.lemma === "dog")!;
    expect(dog.sentences).toEqual({ front: ["The dog barks."], back: ["De hond blaft."] });
    const house = cards.find((c) => c.front[0]?.lemma === "house")!;
    expect(house.sentences).toEqual({ front: [], back: [] });
  });

  it("honors the batch limit and validates query params", async () => {
    expect(((await get("/study?limit=2")).json() as { cards: Card[] }).cards).toHaveLength(2);
    expect((await get("/study?limit=0")).statusCode).toBe(400);
    expect((await get("/study?fromLanguage=en")).statusCode).toBe(400);
  });

  it("caps new cards at the daily limit", async () => {
    await setLimit(2);
    const { counts, cards } = await study();
    expect(counts.new).toBe(2);
    expect(cards).toHaveLength(2);
    await setLimit(20);
  });

  it("is read-only: repeated calls return the same cards", async () => {
    const a = (await study()).cards.map((c) => c.id).sort();
    const b = (await study()).cards.map((c) => c.id).sort();
    expect(a).toEqual(b);
  });
});

describe("POST /reviews", () => {
  let dogId: string;
  let houseId: string;
  let dogReviewId: string;

  it("validates input and requires authentication", async () => {
    const { cards } = await study();
    dogId = cards.find((c) => c.front[0]?.lemma === "dog")!.id;
    houseId = cards.find((c) => c.front[0]?.lemma === "house")!.id;

    const unauth = await app.inject({
      method: "POST",
      url: "/reviews",
      payload: { userCardId: dogId, rating: "good", clientReviewId: randomUUID() },
    });
    expect(unauth.statusCode).toBe(401);
    expect((await review(dogId, "perfect")).statusCode).toBe(400);
    const noId = await app.inject({
      method: "POST",
      url: "/reviews",
      cookies,
      payload: { userCardId: dogId, rating: "good" },
    });
    expect(noId.statusCode).toBe(400);
    expect((await review("00000000-0000-0000-0000-000000000000", "good")).statusCode).toBe(404);
  });

  it("schedules a new card into learning and logs the answer", async () => {
    dogReviewId = randomUUID();
    const before = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/reviews",
      cookies,
      payload: { userCardId: dogId, rating: "good", clientReviewId: dogReviewId, timeTakenMs: 1234 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ userCardId: dogId, state: "learning", replayed: false });
    // reviewedAt is the server clock; dueAt - reviewedAt is the learning step (10 minutes).
    expect(new Date(body.dueAt).getTime() - new Date(body.reviewedAt).getTime()).toBe(10 * 60_000);
    const minutesAway = (new Date(body.dueAt).getTime() - before) / 60_000;
    expect(minutesAway).toBeGreaterThan(9.9);
    expect(minutesAway).toBeLessThan(10.1);

    const [log] = await db.select().from(reviewLogs).where(eq(reviewLogs.clientReviewId, dogReviewId));
    expect(log).toMatchObject({
      userCardId: dogId,
      userId,
      rating: "good",
      stateBefore: "new",
      stateAfter: "learning",
      timeTakenMs: 1234,
    });
    const [card] = await db.select().from(userCards).where(eq(userCards.id, dogId));
    expect(card).toMatchObject({ state: "learning", repetitions: 1 });
    expect(card!.lastReviewedAt).not.toBeNull();
  });

  it("is idempotent for a retried clientReviewId", async () => {
    const [before] = await db.select().from(userCards).where(eq(userCards.id, dogId));
    const res = await app.inject({
      method: "POST",
      url: "/reviews",
      cookies,
      payload: { userCardId: dogId, rating: "good", clientReviewId: dogReviewId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: "learning", replayed: true });
    expect(new Date(res.json().dueAt)).toEqual(before!.dueAt);

    const logs = await db.select().from(reviewLogs).where(eq(reviewLogs.userCardId, dogId));
    expect(logs).toHaveLength(1);
    const [after] = await db.select().from(userCards).where(eq(userCards.id, dogId));
    expect(after).toEqual(before);
  });

  it("rejects reusing a clientReviewId for a different card", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/reviews",
      cookies,
      payload: { userCardId: houseId, rating: "good", clientReviewId: dogReviewId },
    });
    expect(res.statusCode).toBe(409);
  });

  it("handles concurrent retries of the same answer as one review", async () => {
    const id = randomUUID();
    const payload = { userCardId: houseId, rating: "easy", clientReviewId: id };
    const results = await Promise.all(
      [1, 2, 3].map(() => app.inject({ method: "POST", url: "/reviews", cookies, payload })),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(results.filter((r) => r.json().replayed === false)).toHaveLength(1);
    const logs = await db.select().from(reviewLogs).where(eq(reviewLogs.userCardId, houseId));
    expect(logs).toHaveLength(1);
  });

  it("does not let users review each other's cards", async () => {
    const other = await register("other@example.com");
    expect((await review(dogId, "good", {}, other.cookies)).statusCode).toBe(404);
  });
});

describe("study queue after reviews", () => {
  it("offers learning cards that are due soon, ahead of new cards", async () => {
    const { counts, cards } = await study();
    // dog is learning (due in 10m, inside the 20m learn-ahead window)
    expect(counts.learning).toBe(1);
    expect(cards[0]).toMatchObject({ state: "learning" });
    expect(cards[0]!.front[0]!.lemma).toBe("dog");
  });

  it("keeps graduated cards out until they are due, then offers them as reviews", async () => {
    const before = await study();
    expect(before.counts.review).toBe(0);
    expect(before.cards.some((c) => c.front[0]?.lemma === "house")).toBe(false);

    const [house] = await db
      .select()
      .from(userCards)
      .where(eq(userCards.state, "review"));
    expect(house).toBeDefined();
    await db
      .update(userCards)
      .set({ dueAt: new Date(Date.now() - 24 * 3_600_000) })
      .where(eq(userCards.id, house!.id));

    const after = await study();
    expect(after.counts.review).toBe(1);
    expect(after.cards.map((c) => c.state)).toEqual(["learning", "review", "new"]);
  });

  it("counts cards first seen today against the daily new limit, across directions", async () => {
    // dog and house were introduced today (2 cards); with a limit of 2, no new cards remain.
    await setLimit(2);
    const { counts, cards } = await study();
    expect(counts.new).toBe(0);
    expect(cards.some((c) => c.state === "new")).toBe(false);
    await setLimit(20);
  });
});

describe("new card priority", () => {
  // dog, house, water were added in that order, all en->nl and new. Which of them
  // comes first depends on the state of the reverse (nl->en) card.
  async function setup(email: string, reverseOf: "dog" | "house" | "water", reverseState: "review" | "learning" | "relearning" | "new") {
    const me = await register(email);
    const cs = await db.select().from(concepts);
    const id = (key: string) => cs.find((c) => c.key === key)!.id;
    const day = (n: number) => new Date(Date.now() - (10 - n) * 86_400_000);
    await db.insert(userCards).values([
      { userId: me.id, conceptId: id("dog"), fromLanguage: "en", toLanguage: "nl", addedAt: day(1) },
      { userId: me.id, conceptId: id("house"), fromLanguage: "en", toLanguage: "nl", addedAt: day(2) },
      { userId: me.id, conceptId: id("water"), fromLanguage: "en", toLanguage: "nl", addedAt: day(3) },
      {
        userId: me.id,
        conceptId: id(reverseOf),
        fromLanguage: "nl",
        toLanguage: "en",
        state: reverseState,
        dueAt: new Date(Date.now() + 5 * 86_400_000),
        addedAt: day(0),
      },
    ]);
    return me.cookies;
  }
  const newOrder = async (c: { session: string }, qs = "") =>
    ((await get(`/study?limit=20${qs}`, c)).json() as { cards: Card[] }).cards
      .filter((x) => x.state === "new")
      .map((x) => `${x.front[0]?.lemma}`);

  it("puts a new card first when its reverse is in review or relearning", async () => {
    for (const state of ["review", "relearning"] as const) {
      const c = await setup(`priority-${state}@example.com`, "house", state);
      // house was added after dog, but its reverse is known.
      expect(await newOrder(c, "&fromLanguage=en&toLanguage=nl")).toEqual(["house", "dog", "water"]);
    }
  });

  it("keeps the usual order otherwise, including when the reverse is only learning or new", async () => {
    for (const state of ["learning", "new"] as const) {
      const c = await setup(`no-priority-${state}@example.com`, "house", state);
      expect(await newOrder(c, "&fromLanguage=en&toLanguage=nl")).toEqual(["dog", "house", "water"]);
    }
  });

  it("applies in a mixed session too, ahead of older new cards", async () => {
    const c = await setup("mixed@example.com", "dog", "review");
    // The nl->en dog card is a review that is not due, so only the new cards are offered.
    expect(await newOrder(c)).toEqual(["dog", "house", "water"]);
    const c2 = await setup("mixed2@example.com", "water", "review");
    expect(await newOrder(c2)).toEqual(["water", "dog", "house"]);
  });
});
