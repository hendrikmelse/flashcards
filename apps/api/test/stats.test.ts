import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import * as schema from "../src/db/schema.js";
import { concepts, reviewLogs, userCards, users } from "../src/db/schema.js";
import { getStats } from "../src/study/stats.js";

let app: FastifyInstance;
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let userId: string;
let cookies: { session: string };
let conceptIds: string[];

const HOUR = 3_600_000;
const NOW = new Date("2026-01-15T10:00:00Z"); // 11:00 in Amsterdam; the study day began 03:00Z

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);
  app = await buildApp({ db, logger: false });

  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email: "stats@example.com", password: "correct horse battery" },
  });
  cookies = { session: reg.cookies.find((c) => c.name === "session")!.value };
  userId = reg.json().user.id;
  await db.update(users).set({ timezone: "Europe/Amsterdam" }).where(eq(users.id, userId));
  conceptIds = (await db.select().from(concepts)).map((c) => c.id);

  const card = (
    i: number,
    from: string,
    to: string,
    state: "new" | "learning" | "relearning" | "review",
    dueAt: Date,
  ) => ({ userId, conceptId: conceptIds[i]!, fromLanguage: from, toLanguage: to, state, dueAt });
  const inserted = await db
    .insert(userCards)
    .values([
      card(0, "en", "nl", "new", NOW),
      card(1, "en", "nl", "learning", new Date(NOW.getTime() - HOUR)), // due
      card(2, "en", "nl", "review", new Date(NOW.getTime() - 2 * HOUR)), // due
      card(0, "nl", "en", "review", new Date(NOW.getTime() + 5 * HOUR)),
      card(1, "nl", "en", "relearning", new Date(NOW.getTime() + 2 * HOUR)),
    ])
    .returning();

  // Reviews: two inside today's study day, one just before it began (03:00Z),
  // plus two on earlier days that must not count.
  const log = (reviewedAt: string) => ({
    userCardId: inserted[0]!.id,
    userId,
    clientReviewId: randomUUID(),
    rating: "good" as const,
    reviewedAt: new Date(reviewedAt),
    stateBefore: "review" as const,
    stateAfter: "review" as const,
    intervalBeforeDays: 1,
    intervalAfterDays: 2,
    dueAfter: new Date("2026-02-01T00:00:00Z"),
  });
  await db
    .insert(reviewLogs)
    .values([
      log("2026-01-15T09:00:00Z"),
      log("2026-01-15T03:00:00Z"),
      log("2026-01-15T02:59:00Z"), // 03:59 local: still yesterday's study day
      log("2026-01-13T12:00:00Z"),
      log("2026-01-12T12:00:00Z"),
    ]);
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

describe("getStats", () => {
  it("counts the reviews since the study day began", async () => {
    expect((await getStats(db, userId, NOW)).reviewsToday).toBe(2);
  });

  it("breaks down the deck by direction, with when each next comes due", async () => {
    const { directions } = await getStats(db, userId, NOW);
    expect(directions).toEqual([
      {
        fromLanguage: "en",
        toLanguage: "nl",
        total: 3,
        new: 1,
        learning: 1,
        review: 1,
        dueNow: 2,
        nextDueAt: null, // everything there is new or already due
        ready: { learning: 1, review: 1, new: 1 },
      },
      {
        fromLanguage: "nl",
        toLanguage: "en",
        total: 2,
        new: 0,
        learning: 1,
        review: 1,
        dueNow: 0,
        nextDueAt: new Date(NOW.getTime() + 2 * HOUR).toISOString(),
        ready: { learning: 0, review: 0, new: 0 }, // nothing due yet in this direction
      },
    ]);
  });

  it("reports the earliest next due time across directions", async () => {
    expect((await getStats(db, userId, NOW)).nextDueAt).toBe(
      new Date(NOW.getTime() + 2 * HOUR).toISOString(),
    );
  });
});

describe("GET /stats", () => {
  it("requires authentication", async () => {
    expect((await app.inject({ method: "GET", url: "/stats" })).statusCode).toBe(401);
  });

  it("returns the stats for the signed-in user", async () => {
    const res = await app.inject({ method: "GET", url: "/stats", cookies });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.directions).toHaveLength(2);
    expect(body.reviewsToday).toEqual(expect.any(Number));
  });

  it("is empty for a user with no history", async () => {
    const other = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "fresh@example.com", password: "another password" },
    });
    const c = { session: other.cookies.find((x) => x.name === "session")!.value };
    const body = (await app.inject({ method: "GET", url: "/stats", cookies: c })).json();
    expect(body).toMatchObject({
      reviewsToday: 0,
      nextDueAt: null,
      directions: [],
    });
  });
});

describe("GET /deck list filters", () => {
  const list = async (params: string) => {
    const res = await app.inject({ method: "GET", url: `/deck?${params}`, cookies });
    return { status: res.statusCode, body: res.json() };
  };
  const states = (body: { cards: { state: string }[] }) => body.cards.map((c) => c.state);

  it("filters by stage, with learning including relearning", async () => {
    expect(states((await list("state=new")).body)).toEqual(["new"]);
    expect((await list("state=review")).body.cards).toHaveLength(2);
    expect(states((await list("state=learning&sort=due")).body)).toEqual(["learning", "relearning"]);
  });

  it("searches the words in either language of each card", async () => {
    const hond = (await list("q=hond")).body.cards;
    expect(hond).toHaveLength(2); // dog, in both directions
    expect(hond.every((c: { front: { lemma: string }[] }) => ["dog", "hond"].includes(c.front[0]!.lemma))).toBe(true);
    expect((await list("q=HUIS")).body.cards).toHaveLength(2);
    expect((await list("q=zzz")).body.cards).toEqual([]);
    expect((await list("q=%25")).body.cards).toEqual([]); // % is literal
  });

  it("combines the direction, stage and search filters", async () => {
    const { body } = await list("fromLanguage=nl&toLanguage=en&state=review&q=hond");
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]).toMatchObject({ fromLanguage: "nl", state: "review" });
  });

  it("can sort by due date, soonest first with unstudied cards last", async () => {
    expect(states((await list("sort=due")).body)).toEqual([
      "review",
      "learning",
      "relearning",
      "review",
      "new",
    ]);
  });

  it("pages and reports whether more cards match", async () => {
    const first = (await list("sort=due&limit=2")).body;
    expect(first.cards).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const last = (await list("sort=due&limit=2&offset=4")).body;
    expect(last.cards).toHaveLength(1);
    expect(last.hasMore).toBe(false);
  });

  it("keeps the summary for the whole direction, whatever the filters", async () => {
    const { body } = await list("fromLanguage=en&toLanguage=nl&state=review&q=zzz");
    expect(body.summary).toMatchObject({ total: 3, new: 1, learning: 1, review: 1 });
  });

  it("includes what the card list shows", async () => {
    const [card] = (await list("state=review&fromLanguage=nl&toLanguage=en")).body.cards;
    expect(card).toMatchObject({ state: "review", lapses: 0 });
    expect(card).toHaveProperty("intervalDays");
    expect(card).toHaveProperty("dueAt");
  });

  describe("sorting", () => {
    // Cards: dog en>nl new (due 10:00), house en>nl learning (09:00), water en>nl review (08:00),
    // hond nl>en review (15:00), huis nl>en relearning (12:00).
    beforeAll(async () => {
      const mine = await db.select().from(userCards).where(eq(userCards.userId, userId));
      const set = async (conceptIndex: number, from: string, values: { intervalDays?: number; lapses?: number }) => {
        const c = mine.find((x) => x.conceptId === conceptIds[conceptIndex] && x.fromLanguage === from)!;
        await db.update(userCards).set(values).where(eq(userCards.id, c.id));
      };
      await set(0, "nl", { intervalDays: 30 });
      await set(2, "en", { intervalDays: 7, lapses: 3 });
      await set(1, "nl", { lapses: 1 });
    });

    const sorted = async (params: string) => states((await list(`sort=${params}`)).body);
    const prompts = async (params: string) =>
      (await list(`sort=${params}`)).body.cards.map((c: { front: { lemma: string }[] }) => c.front[0]!.lemma);

    it("sorts by status, in order of progress", async () => {
      expect(await sorted("status")).toEqual(["new", "learning", "relearning", "review", "review"]);
      expect(await sorted("status&order=desc")).toEqual(["review", "review", "relearning", "learning", "new"]);
    });

    it("cannot be sorted by interval or lapses", async () => {
      expect((await list("sort=interval")).status).toBe(400);
      expect((await list("sort=lapses")).status).toBe(400);
    });

    it("sorts alphabetically by the prompt word", async () => {
      expect(await prompts("alpha")).toEqual(["dog", "hond", "house", "huis", "water"]);
      expect(await prompts("alpha&order=desc")).toEqual(["water", "huis", "house", "hond", "dog"]);
    });

    it("can reverse the due order, still leaving unstudied cards last", async () => {
      expect(await sorted("due&order=desc")).toEqual(["review", "relearning", "learning", "review", "new"]);
    });

    it("keeps pages consistent when sorting", async () => {
      const first = (await list("sort=status&limit=2")).body.cards.map((c: { id: string }) => c.id);
      const rest = (await list("sort=status&limit=3&offset=2")).body.cards.map((c: { id: string }) => c.id);
      const all = (await list("sort=status&limit=5")).body.cards.map((c: { id: string }) => c.id);
      expect([...first, ...rest]).toEqual(all);
    });

    it("rejects an unknown sort or order", async () => {
      expect((await list("sort=bogus")).status).toBe(400);
      expect((await list("order=sideways")).status).toBe(400);
    });
  });

  it("rejects an unknown stage", async () => {
    expect((await list("state=bogus")).status).toBe(400);
  });
});

describe("adding reverse (mirror) cards", () => {
  let c: { session: string };

  // dog: both directions. house: only en->nl. water: only nl->en.
  beforeAll(async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "mirror@example.com", password: "correct horse battery" },
    });
    c = { session: reg.cookies.find((x) => x.name === "session")!.value };
    const id = reg.json().user.id as string;
    const card = (i: number, from: string, to: string, state: "new" | "review" = "new") => ({
      userId: id,
      conceptId: conceptIds[i]!,
      fromLanguage: from,
      toLanguage: to,
      state,
    });
    await db
      .insert(userCards)
      .values([card(0, "en", "nl", "review"), card(0, "nl", "en"), card(1, "en", "nl"), card(2, "nl", "en")]);
  });

  const get = async (qs = "") =>
    (await app.inject({ method: "GET", url: `/deck?limit=50${qs}`, cookies: c })).json();
  const post = (payload: object = {}) =>
    app.inject({ method: "POST", url: "/deck/mirrors", payload, cookies: c });
  const mirrored = (cards: { front: { lemma: string }[]; fromLanguage: string; hasMirror: boolean }[]) =>
    Object.fromEntries(cards.map((x) => [`${x.fromLanguage}:${x.front[0]!.lemma}`, x.hasMirror]));

  it("flags each card by whether its reverse is in the deck", async () => {
    const body = await get();
    expect(mirrored(body.cards)).toEqual({
      "en:dog": true,
      "nl:hond": true,
      "en:house": false,
      "nl:water": false,
    });
    expect(body.mirrorable).toBe(2);
  });

  it("can show only the cards that are missing a reverse", async () => {
    const body = await get("&missingMirror=1");
    expect(body.cards).toHaveLength(2);
    expect(body.cards.every((x: { hasMirror: boolean }) => !x.hasMirror)).toBe(true);
  });

  it("counts what could be mirrored within the current view", async () => {
    expect((await get("&fromLanguage=en&toLanguage=nl")).mirrorable).toBe(1);
    expect((await get("&state=review")).mirrorable).toBe(0); // dog already has both
    expect((await get("&q=house")).mirrorable).toBe(1);
    expect((await get("&q=zzz")).mirrorable).toBe(0);
  });

  it("requires authentication and a valid direction", async () => {
    expect((await app.inject({ method: "POST", url: "/deck/mirrors", payload: {} })).statusCode).toBe(401);
    expect((await post({ fromLanguage: "en" })).statusCode).toBe(400);
    expect((await post({ state: "bogus" })).statusCode).toBe(400);
  });

  it("adds reverse cards only for the cards in the chosen view", async () => {
    const res = await post({ fromLanguage: "en", toLanguage: "nl" });
    expect(res.json()).toEqual({ added: 1 });

    const body = await get();
    expect(body.cards).toHaveLength(5);
    const house = body.cards.find(
      (x: { fromLanguage: string; front: { lemma: string }[] }) => x.fromLanguage === "nl" && x.front[0]!.lemma === "huis",
    );
    expect(house).toMatchObject({ state: "new", hasMirror: true });
    expect(body.mirrorable).toBe(1); // water, the other direction, was left alone
  });

  it("can mirror the whole deck, and is idempotent", async () => {
    expect((await post()).json()).toEqual({ added: 1 });
    const body = await get();
    expect(body.cards).toHaveLength(6);
    expect(body.mirrorable).toBe(0);
    expect((await post()).json()).toEqual({ added: 0 });
  });

  it("leaves other users' decks alone", async () => {
    const other = await app.inject({ method: "GET", url: "/deck?limit=50", cookies });
    expect(other.json().summary.total).toBe(5);
  });
});
