import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFsrsScheduler } from "../src/srs/engine.js";
import { studyDayStart } from "../src/study/day.js";
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
  it("holds learning cards back until 15 minutes after the last answer", async () => {
    // dog was just answered, so it is in learning (due in 10 minutes), but the session gap holds it.
    const batch = await study();
    expect(batch.counts.learning).toBe(0);
    expect(batch.cards.some((c) => c.state === "learning")).toBe(false);

    const res = (await get("/study/counts")).json() as {
      counts: { learning: number };
      nextSession: { at: string; count: number } | null;
    };
    expect(res.nextSession).not.toBeNull();
    expect(res.nextSession!.count).toBe(1); // dog, ready when the wait is over
    const [last] = await db
      .select({ at: sql<Date>`max(${reviewLogs.reviewedAt})` })
      .from(reviewLogs)
      .where(eq(reviewLogs.userId, userId));
    expect(Date.parse(res.nextSession!.at)).toBe(new Date(last!.at).getTime() + 15 * 60_000);

    // Age the reviews so the gap has passed, for the tests that follow.
    await db
      .update(reviewLogs)
      .set({ reviewedAt: sql`${reviewLogs.reviewedAt} - interval '20 minutes'` })
      .where(eq(reviewLogs.userId, userId));
    const after = (await get("/study/counts")).json() as { nextSession: unknown };
    expect(after.nextSession).toBeNull();
  });

  it("offers learning cards that are due soon, alongside new cards", async () => {
    const { counts, cards } = await study();
    // dog is learning (due in 10m, inside the 20m learn-ahead window)
    expect(counts.learning).toBe(1);
    const dog = cards.find((c) => c.state === "learning")!;
    expect(dog.front[0]!.lemma).toBe("dog");
    // With so few cards, the one new card (water) is mixed in at the very front.
    expect(cards.map((c) => c.state)).toEqual(["new", "learning"]);
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
    // A day overdue: last reviewed nine days ago, due yesterday.
    await db
      .update(userCards)
      .set({
        dueAt: new Date(Date.now() - 24 * 3_600_000),
        lastReviewedAt: new Date(Date.now() - 9 * 24 * 3_600_000),
      })
      .where(eq(userCards.id, house!.id));

    const after = await study();
    expect(after.counts.review).toBe(1);
    // The review is the likeliest to be forgotten, so it leads; the new card is mixed in
    // after it, and the learning card (recalled a moment ago) comes last.
    expect(after.cards.map((c) => c.state)).toEqual(["review", "new", "learning"]);
  });

  it("does not count new cards that were marked Good or Easy against the daily limit", async () => {
    // dog (Good) and house (Easy) were new cards seen today, but they were already known.
    // With a limit of 1 the one remaining new card is still available; if they counted, none would be.
    await setLimit(1);
    const { counts, cards } = await study();
    expect(counts.new).toBe(1);
    expect(cards.some((c) => c.state === "new")).toBe(true);
    await setLimit(20);
  });
});

// Sign-ups are rate limited, so the tests below share one user and clear their cards each time.
let scratch: { cookies: { session: string }; id: string } | undefined;
async function scratchUser() {
  scratch ??= await register("scratch@example.com");
  await db.delete(userCards).where(eq(userCards.userId, scratch.id));
  return scratch;
}

describe("new card priority", () => {
  // dog, house, water were added in that order, all en->nl and new. Which of them
  // comes first depends on the state of the reverse (nl->en) card.
  async function setup(email: string, reverseOf: "dog" | "house" | "water", reverseState: "review" | "learning" | "relearning" | "new") {
    const me = await scratchUser();
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

describe("study queue order", () => {
  // A review due now, with a stability and age that make it more or less likely to be forgotten.
  async function reviews(email: string, specs: { key: string; stability: number; daysAgo: number }[], newKeys: string[] = []) {
    const me = await scratchUser();
    const cs = await db.select().from(concepts);
    const id = (key: string) => cs.find((c) => c.key === key)!.id;
    const day = 86_400_000;
    await db.insert(userCards).values([
      ...specs.map((s) => ({
        userId: me.id,
        conceptId: id(s.key),
        fromLanguage: "en",
        toLanguage: "nl",
        state: "review" as const,
        stability: s.stability,
        difficulty: 5,
        intervalDays: s.stability,
        repetitions: 3,
        lastReviewedAt: new Date(Date.now() - s.daysAgo * day),
        dueAt: new Date(Date.now() - 1000),
      })),
      ...newKeys.map((k) => ({ userId: me.id, conceptId: id(k), fromLanguage: "en", toLanguage: "nl" })),
    ]);
    return me.cookies;
  }
  const order = async (c: { session: string }) =>
    ((await get("/study?limit=50", c)).json() as { cards: Card[] }).cards.map((x) => `${x.state}:${x.front[0]?.lemma}`);

  it("puts the review most likely to be forgotten first, not the most overdue", async () => {
    // dog: well learned (stability 100) and long overdue; house: shaky (stability 2), only a bit overdue.
    const c = await reviews("rank@example.com", [
      { key: "dog", stability: 100, daysAgo: 120 },
      { key: "house", stability: 2, daysAgo: 6 },
    ]);
    expect(await order(c)).toEqual(["review:house", "review:dog"]);
  });

  it("mixes new cards in near the front of the queue", async () => {
    const c = await reviews(
      "mix@example.com",
      [
        { key: "dog", stability: 3, daysAgo: 8 },
        { key: "house", stability: 4, daysAgo: 8 },
      ],
      ["water"],
    );
    const out = await order(c);
    expect(out).toHaveLength(3);
    // One new card among two reviews: the first half of the queue, after the likeliest-forgotten review.
    expect(out[1]).toBe("new:water");
  });
});

describe("GET /study/counts", () => {
  it("requires authentication and a complete direction", async () => {
    expect((await app.inject({ method: "GET", url: "/study/counts" })).statusCode).toBe(401);
    expect((await get("/study/counts?fromLanguage=en")).statusCode).toBe(400);
  });

  it("returns the same counts as a study batch, without any cards", async () => {
    const batch = (await get("/study")).json() as { counts: object };
    const res = (await get("/study/counts")).json() as { counts: object; cards?: unknown };
    expect(res.counts).toEqual(batch.counts);
    expect(res.cards).toBeUndefined();
  });
});

describe("the gap between sessions", () => {
  const MIN = 60_000;
  // A user with one learning card and one review card, both already due, whose last
  // answer was `lastAnswerMinutesAgo` minutes ago.
  async function user(_label: string, lastAnswerMinutesAgo: number, extra: { reviewDueInMin?: number } = {}) {
    const me = await scratchUser(); // clears their cards, and with them their history
    const cs = await db.select().from(concepts);
    const id = (key: string) => cs.find((c) => c.key === key)!.id;
    const [learning, review] = await db
      .insert(userCards)
      .values([
        {
          userId: me.id,
          conceptId: id("dog"),
          fromLanguage: "en",
          toLanguage: "nl",
          state: "learning",
          stability: 0.5,
          lastReviewedAt: new Date(Date.now() - lastAnswerMinutesAgo * MIN),
          dueAt: new Date(Date.now() - 1 * MIN),
        },
        {
          userId: me.id,
          conceptId: id("house"),
          fromLanguage: "en",
          toLanguage: "nl",
          state: "review",
          stability: 5,
          lastReviewedAt: new Date(Date.now() - 6 * 86_400_000),
          dueAt: new Date(Date.now() + (extra.reviewDueInMin ?? -60) * MIN),
        },
      ])
      .returning();
    await db.insert(reviewLogs).values({
      userCardId: learning!.id,
      userId: me.id,
      clientReviewId: randomUUID(),
      rating: "good",
      reviewedAt: new Date(Date.now() - lastAnswerMinutesAgo * MIN),
      stateBefore: "new",
      stateAfter: "learning",
      intervalBeforeDays: 0,
      intervalAfterDays: 0,
      dueAfter: new Date(Date.now() - 1 * MIN),
    });
    void review;
    return me.cookies;
  }
  const states = async (c: { session: string }, qs = "") =>
    ((await get(`/study?limit=50${qs}`, c)).json() as { cards: Card[] }).cards.map((x) => x.state).sort();
  const counts = async (c: { session: string }) =>
    (await get("/study/counts", c)).json() as {
      counts: { learning: number; review: number; new: number };
      nextSession: { at: string; count: number } | null;
    };

  it("holds learning cards back during the gap but not due reviews", async () => {
    const c = await user("gap-held@example.com", 2);
    expect(await states(c)).toEqual(["review"]);
    const res = await counts(c);
    expect(res.counts).toEqual({ learning: 0, review: 1, new: 0 });
    // Everything ready when the gap ends: the learning card, plus the review that is already due.
    expect(res.nextSession!.count).toBe(2);
    const wait = Date.parse(res.nextSession!.at) - Date.now();
    expect(wait).toBeGreaterThan(12 * MIN);
    expect(wait).toBeLessThanOrEqual(13 * MIN);
  });

  it("offers them once 15 minutes have passed since the last answer", async () => {
    const c = await user("gap-open@example.com", 16);
    expect(await states(c)).toEqual(["learning", "review"]);
    expect((await counts(c)).nextSession).toBeNull();
  });

  it("counts reviews that fall due before the gap ends as part of the next session", async () => {
    const c = await user("gap-soon@example.com", 2, { reviewDueInMin: 8 });
    const res = await counts(c);
    expect(res.counts).toEqual({ learning: 0, review: 0, new: 0 });
    expect(res.nextSession!.count).toBe(2); // the learning card and the review due in 8 minutes
  });

  it("does not hold back a review that is due in more than the gap", async () => {
    const c = await user("gap-far@example.com", 2, { reviewDueInMin: 120 });
    expect((await counts(c)).nextSession!.count).toBe(1); // just the learning card
  });

  it("lets the next session start early in the last five minutes, with everything due by then", async () => {
    // Last answer 11 minutes ago: the gap ends in 4 minutes. A review due in 3 minutes is part of it.
    const c = await user("gap-early@example.com", 11, { reviewDueInMin: 3 });
    expect(await states(c)).toEqual([]);
    expect(await states(c, "&early=1")).toEqual(["learning", "review"]);
  });

  it("does not allow starting early with more than five minutes to go", async () => {
    const c = await user("gap-toosoon@example.com", 5);
    // Only the review that is already due; the held-back learning card does not come early.
    expect(await states(c, "&early=1")).toEqual(["review"]);
  });

  it("ignores the early flag when there is no wait", async () => {
    const c = await user("gap-none@example.com", 30);
    expect(await states(c, "&early=1")).toEqual(await states(c));
  });
});

describe("what is ready tomorrow", () => {
  const HOUR = 3_600_000;
  // Cards of the given states, due `dueInHours` from now, for a user with the given daily limit.
  async function user(
    cards: { state: "review" | "learning" | "new"; dueInHours?: number }[],
    limit = 20,
  ) {
    const me = await scratchUser();
    await db.update(users).set({ dailyNewCardLimit: limit }).where(eq(users.id, me.id));
    const cs = await db.select().from(concepts);
    await db.insert(userCards).values(
      cards.map((c, i) => ({
        userId: me.id,
        conceptId: cs[i % cs.length]!.id,
        // A different direction per lap, so the same word can be used more than once.
        fromLanguage: i < cs.length ? "en" : "nl",
        toLanguage: i < cs.length ? "nl" : "en",
        state: c.state,
        stability: c.state === "new" ? null : 5,
        lastReviewedAt: c.state === "new" ? null : new Date(Date.now() - 3 * 24 * HOUR),
        dueAt: new Date(Date.now() + (c.dueInHours ?? 0) * HOUR),
      })),
    );
    return me.cookies;
  }
  const tomorrow = async (c: { session: string }) =>
    ((await get("/study/counts", c)).json() as { tomorrow: number; counts: { review: number; new: number } });

  it("counts cards due by the end of tomorrow, and not ones due later", async () => {
    // 20 hours is always within tomorrow's study day; 60 hours never is.
    const c = await user([
      { state: "review", dueInHours: 20 },
      { state: "review", dueInHours: 20 },
      { state: "review", dueInHours: 60 },
    ]);
    const res = await tomorrow(c);
    expect(res.counts.review).toBe(0); // nothing is ready right now
    expect(res.tomorrow).toBe(2);
  });

  it("counts learning cards that fall due by then too", async () => {
    const c = await user([{ state: "learning", dueInHours: 10 }]);
    expect((await tomorrow(c)).tomorrow).toBe(1);
  });

  it("adds the new cards tomorrow's daily limit will let in", async () => {
    const c = await user(
      [{ state: "new" }, { state: "new" }, { state: "new" }],
      2, // only two new cards a day
    );
    // Today's limit is not used up here, but tomorrow's is what matters: two of the three.
    expect((await tomorrow(c)).tomorrow).toBe(2);
  });

  it("combines due cards and new cards", async () => {
    const c = await user([{ state: "review", dueInHours: 20 }, { state: "new" }, { state: "new" }], 20);
    expect((await tomorrow(c)).tomorrow).toBe(3);
  });

  it("is zero when there is nothing due soon and no new cards", async () => {
    const c = await user([{ state: "review", dueInHours: 200 }]);
    expect((await tomorrow(c)).tomorrow).toBe(0);
  });
});

describe("review cards come due at the start of a study day", () => {
  // A card on its last learning step, about to graduate when answered Good.
  async function graduate(timezone: string) {
    const me = await scratchUser();
    await db.update(users).set({ timezone }).where(eq(users.id, me.id));
    const cs = await db.select().from(concepts);
    const [card] = await db
      .insert(userCards)
      .values({
        userId: me.id,
        conceptId: cs[0]!.id,
        fromLanguage: "en",
        toLanguage: "nl",
        state: "learning",
        stability: 0.5,
        difficulty: 5,
        learningStep: 1,
        repetitions: 1,
        lastReviewedAt: new Date(Date.now() - 10 * 60_000),
        dueAt: new Date(Date.now() - 1000),
      })
      .returning();
    const res = await review(card!.id, "good", {}, me.cookies);
    expect(res.statusCode).toBe(200);
    return res.json() as { state: string; dueAt: string; intervalDays: number };
  }

  it("makes a card that graduates due at 04:00, not mid-day", async () => {
    const r = await graduate("UTC");
    expect(r.state).toBe("review");
    const due = new Date(r.dueAt);
    expect(due.getTime()).toBe(studyDayStart(due, "UTC").getTime());
    expect(due.getUTCHours()).toBe(4);
    // Within a day before the interval was up.
    const nominal = Date.now() + r.intervalDays * 86_400_000;
    expect(nominal - due.getTime()).toBeGreaterThanOrEqual(-60_000);
    expect(nominal - due.getTime()).toBeLessThan(24 * 3_600_000 + 60_000);
  });

  it("uses the user's time zone", async () => {
    const r = await graduate("America/New_York");
    const due = new Date(r.dueAt);
    expect(due.getTime()).toBe(studyDayStart(due, "America/New_York").getTime());
    expect([8, 9]).toContain(due.getUTCHours()); // 04:00 in New York is 08:00Z or 09:00Z
  });

  it("holds a card that comes due at 04:00 out of today's queue, and offers it from then", async () => {
    const me = await scratchUser();
    const cs = await db.select().from(concepts);
    const startOfToday = studyDayStart(new Date(), "UTC");
    const nextStart = new Date(studyDayStart(new Date(startOfToday.getTime() + 30 * 3_600_000), "UTC"));
    await db
      .insert(userCards)
      .values([
        // Became due when today's study day began, so it is available now.
        { userId: me.id, conceptId: cs[0]!.id, fromLanguage: "en", toLanguage: "nl", state: "review", stability: 5, difficulty: 5, lastReviewedAt: new Date(startOfToday.getTime() - 3 * 86_400_000), dueAt: startOfToday },
        // Due when tomorrow's begins, so not yet.
        { userId: me.id, conceptId: cs[1]!.id, fromLanguage: "en", toLanguage: "nl", state: "review", stability: 5, difficulty: 5, lastReviewedAt: new Date(startOfToday.getTime() - 2 * 86_400_000), dueAt: nextStart },
      ]);
    const { cards } = (await get("/study?limit=20", me.cookies)).json() as { cards: Card[] };
    expect(cards).toHaveLength(1);
  });
});

describe("the daily new-card limit", () => {
  // Six new cards (three words, both directions) and a limit of 2. `logs` are first looks at new
  // cards today, or at the given time, with the rating given.
  async function setup(
    logs: { rating: "again" | "hard" | "good" | "easy"; stateBefore?: "new" | "learning"; when?: Date }[],
    limit = 2,
  ) {
    const me = await scratchUser();
    await db.update(users).set({ dailyNewCardLimit: limit }).where(eq(users.id, me.id));
    const cs = await db.select().from(concepts);
    // The first cards are the ones that were looked at; they are no longer new.
    const cards = await db
      .insert(userCards)
      .values(
        ["en", "nl"].flatMap((from) =>
          cs.map((c) => ({ userId: me.id, conceptId: c.id, fromLanguage: from, toLanguage: from === "en" ? "nl" : "en" })),
        ),
      )
      .returning();
    for (const card of cards.slice(0, logs.length)) {
      await db
        .update(userCards)
        .set({ state: "learning", dueAt: new Date(Date.now() + 600_000) })
        .where(eq(userCards.id, card.id));
    }
    if (logs.length > 0)
      await db.insert(reviewLogs).values(
      logs.map((l, i) => ({
        userCardId: cards[i]!.id,
        userId: me.id,
        clientReviewId: randomUUID(),
        rating: l.rating,
        reviewedAt: l.when ?? new Date(Date.now() - 1000),
        stateBefore: l.stateBefore ?? "new",
        stateAfter: "learning" as const,
        intervalBeforeDays: 0,
        intervalAfterDays: 0,
        dueAfter: new Date(Date.now() + 600_000),
      })),
    );
    return me.cookies;
  }
  const newCount = async (c: { session: string }) =>
    ((await get("/study/counts", c)).json() as { counts: { new: number } }).counts.new;

  it("starts at the limit", async () => {
    expect(await newCount(await setup([]))).toBe(2);
  });

  it("does not count a new card marked Good or Easy, however many there are", async () => {
    expect(await newCount(await setup([{ rating: "good" }, { rating: "easy" }, { rating: "good" }, { rating: "easy" }]))).toBe(2);
  });

  it("counts a new card marked Again or Hard", async () => {
    expect(await newCount(await setup([{ rating: "hard" }]))).toBe(1);
    expect(await newCount(await setup([{ rating: "again" }]))).toBe(1);
    expect(await newCount(await setup([{ rating: "again" }, { rating: "hard" }]))).toBe(0);
  });

  it("counts only the ones that needed learning when the answers are mixed", async () => {
    expect(await newCount(await setup([{ rating: "easy" }, { rating: "hard" }, { rating: "good" }, { rating: "easy" }]))).toBe(1);
  });

  it("goes by the first look only: a later answer to the same card does not count", async () => {
    // Answered Again later, but not as a new card (it was already in learning).
    expect(await newCount(await setup([{ rating: "again", stateBefore: "learning" }, { rating: "hard", stateBefore: "learning" }]))).toBe(2);
  });

  it("only counts today: a hard first look yesterday is forgotten", async () => {
    const yesterday = new Date(Date.now() - 2 * 86_400_000);
    expect(await newCount(await setup([{ rating: "hard", when: yesterday }, { rating: "again" }]))).toBe(1);
  });

  it("shows up as fewer new cards offered in a session, and none once the limit is used by Again and Hard", async () => {
    const c = await setup([{ rating: "easy" }, { rating: "again" }, { rating: "hard" }]);
    const { cards } = (await get("/study?limit=50", c)).json() as { cards: Card[] };
    expect(cards.filter((x) => x.state === "new")).toHaveLength(0);
  });

  it("lets a known word through without using up the allowance, so a run of known words keeps going", async () => {
    // Limit 2, five new cards each marked Good: the allowance is untouched, so two more are offered.
    const c = await setup([{ rating: "good" }, { rating: "good" }, { rating: "good" }, { rating: "good" }, { rating: "good" }]);
    const { cards } = (await get("/study?limit=50", c)).json() as { cards: Card[] };
    expect(cards.filter((x) => x.state === "new")).toHaveLength(1); // the one new card left (six minus five seen)
    expect(await newCount(c)).toBe(1);
  });
});
