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
import { reviewLogs, userCards, users } from "../src/db/schema.js";
import { createFsrsScheduler } from "../src/srs/engine.js";

// Undoing an answer: the card goes back to exactly how it was, and the answer stops counting.

type Cookies = { session: string };
let app: FastifyInstance;
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let n = 0;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);
  app = await buildApp({ db, logger: false, authRateLimit: 1000, scheduler: createFsrsScheduler({ fuzz: false }) });
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

// A fresh user with the sample pack's six cards (three words, both ways), all new.
async function learner(limit = 20) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email: `undo${++n}@example.com`, password: "correct horse battery" },
  });
  const cookies: Cookies = { session: res.cookies.find((c) => c.name === "session")!.value };
  const id = res.json().user.id as string;
  await db.update(users).set({ dailyNewCardLimit: limit }).where(eq(users.id, id));
  const packs = await app.inject({ method: "GET", url: "/packs" });
  await app.inject({
    method: "POST",
    url: `/packs/${packs.json().packs[0].id}/add`,
    cookies,
    payload: { fromLanguage: "en", toLanguage: "nl", bothDirections: true },
  });
  return { cookies, id };
}

const get = (url: string, cookies: Cookies) => app.inject({ method: "GET", url, cookies });
const answer = (cookies: Cookies, userCardId: string, rating: string, clientReviewId = randomUUID()) =>
  app.inject({ method: "POST", url: "/reviews", cookies, payload: { userCardId, rating, clientReviewId } }).then((res) => ({ res, clientReviewId }));
const undo = (cookies: Cookies, clientReviewId: string) =>
  app.inject({ method: "POST", url: "/reviews/undo", cookies, payload: { clientReviewId } });
const cardRow = async (id: string) => (await db.select().from(userCards).where(eq(userCards.id, id)))[0]!;
const firstCard = async (cookies: Cookies) => ((await get("/study?limit=50", cookies)).json().cards[0] as { id: string });

describe("POST /reviews/undo", () => {
  it("puts the card back exactly as it was before the answer", async () => {
    const { cookies } = await learner();
    const { id } = await firstCard(cookies);
    const before = await cardRow(id);
    const { clientReviewId, res } = await answer(cookies, id, "good");
    expect(res.statusCode).toBe(200);
    expect((await cardRow(id)).state).not.toBe("new");

    const undone = await undo(cookies, clientReviewId);
    expect(undone.statusCode).toBe(200);
    expect(undone.json()).toMatchObject({ userCardId: id, state: "new", undone: true, replayed: false });
    expect(await cardRow(id)).toEqual(before);
  });

  it("restores a card that was in review, with its stability, difficulty and lapses", async () => {
    const { cookies, id: userId } = await learner();
    const { id } = await firstCard(cookies);
    await db
      .update(userCards)
      .set({ state: "review", stability: 12.5, difficulty: 4.2, repetitions: 5, lapses: 1, intervalDays: 12, dueAt: new Date(Date.now() - 1000), lastReviewedAt: new Date(Date.now() - 12 * 86_400_000) })
      .where(eq(userCards.id, id));
    const before = await cardRow(id);
    const { clientReviewId } = await answer(cookies, id, "again");
    expect((await cardRow(id)).lapses).toBe(2);
    expect((await undo(cookies, clientReviewId)).statusCode).toBe(200);
    expect(await cardRow(id)).toEqual(before);
    void userId;
  });

  it("keeps the log row, marked as undone, and does the same when asked twice", async () => {
    const { cookies } = await learner();
    const { id } = await firstCard(cookies);
    const { clientReviewId } = await answer(cookies, id, "hard");
    expect((await undo(cookies, clientReviewId)).statusCode).toBe(200);
    const [log] = await db.select().from(reviewLogs).where(eq(reviewLogs.clientReviewId, clientReviewId));
    expect(log!.undoneAt).toBeInstanceOf(Date);

    const again = await undo(cookies, clientReviewId);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ undone: true, replayed: true });
    expect(await db.select().from(reviewLogs).where(eq(reviewLogs.userCardId, id))).toHaveLength(1);
  });

  it("lets the card be answered again afterwards, with a new answer id", async () => {
    const { cookies } = await learner();
    const { id } = await firstCard(cookies);
    const first = await answer(cookies, id, "again");
    await undo(cookies, first.clientReviewId);
    const second = await answer(cookies, id, "easy");
    expect(second.res.statusCode).toBe(200);
    expect(second.res.json().state).toBe("review");
  });

  it("does not count an undone answer toward the daily new-card limit", async () => {
    const { cookies } = await learner(2);
    const newCards = async () => (await get("/study/counts", cookies)).json().counts.new as number;
    expect(await newCards()).toBe(2);
    const { id } = await firstCard(cookies);
    const { clientReviewId } = await answer(cookies, id, "hard"); // a first look that needed learning: uses the limit
    expect(await newCards()).toBe(1);
    await undo(cookies, clientReviewId);
    expect(await newCards()).toBe(2);
  });

  it("is not the first session any more only while an answer stands", async () => {
    const { cookies } = await learner();
    const { id } = await firstCard(cookies);
    const { clientReviewId } = await answer(cookies, id, "good");
    expect((await get("/study?limit=5", cookies)).json().firstSession).toBe(false);
    await undo(cookies, clientReviewId);
    expect((await get("/study?limit=5", cookies)).json().firstSession).toBe(true);
  });

  it("only takes back the latest answer of a card, and then the one before it", async () => {
    const { cookies } = await learner();
    const { id } = await firstCard(cookies);
    const first = await answer(cookies, id, "again");
    const second = await answer(cookies, id, "good");

    const tooOld = await undo(cookies, first.clientReviewId);
    expect(tooOld.statusCode).toBe(409);
    expect(tooOld.json().error).toMatch(/answered again/);

    expect((await undo(cookies, second.clientReviewId)).statusCode).toBe(200);
    expect((await undo(cookies, first.clientReviewId)).statusCode).toBe(200);
    expect((await cardRow(id)).state).toBe("new");
  });

  it("refuses once too long has passed, by the server's clock", async () => {
    const { cookies } = await learner();
    const { id } = await firstCard(cookies);
    const { clientReviewId } = await answer(cookies, id, "good");
    await db.update(reviewLogs).set({ reviewedAt: new Date(Date.now() - 61_000) }).where(eq(reviewLogs.clientReviewId, clientReviewId));
    const res = await undo(cookies, clientReviewId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/too late/i);
    expect((await cardRow(id)).state).not.toBe("new");
  });

  it("refuses an answer from before undo existed, which has nothing to restore it from", async () => {
    const { cookies } = await learner();
    const { id } = await firstCard(cookies);
    const { clientReviewId } = await answer(cookies, id, "good");
    await db.update(reviewLogs).set({ cardBefore: null }).where(eq(reviewLogs.clientReviewId, clientReviewId));
    expect((await undo(cookies, clientReviewId)).statusCode).toBe(409);
  });

  it("treats someone else's answer, or one that does not exist, as not found", async () => {
    const mine = await learner();
    const theirs = await learner();
    const { id } = await firstCard(mine.cookies);
    const { clientReviewId } = await answer(mine.cookies, id, "good");
    expect((await undo(theirs.cookies, clientReviewId)).statusCode).toBe(404);
    expect((await undo(mine.cookies, randomUUID())).statusCode).toBe(404);
    expect((await cardRow(id)).state).not.toBe("new");
  });

  it("needs sign-in and a proper id", async () => {
    const { cookies } = await learner();
    expect((await app.inject({ method: "POST", url: "/reviews/undo", payload: { clientReviewId: randomUUID() } })).statusCode).toBe(401);
    expect((await undo(cookies, "nope")).statusCode).toBe(400);
  });
});

describe("what undone answers leave out", () => {
  it("is not counted in the admin statistics", async () => {
    const { cookies, id: userId } = await learner();
    await db.update(users).set({ role: "admin" }).where(eq(users.id, userId));
    const stats = async () => ((await get("/admin/stats", cookies)).json() as { reviews: { total: number } }).reviews.total;
    const before = await stats();
    const { id } = await firstCard(cookies);
    const { clientReviewId } = await answer(cookies, id, "good");
    expect(await stats()).toBe(before + 1);
    await undo(cookies, clientReviewId);
    expect(await stats()).toBe(before);
  });

  it("is still in the account export, marked as undone", async () => {
    const { cookies } = await learner();
    const { id } = await firstCard(cookies);
    const { clientReviewId } = await answer(cookies, id, "good");
    await undo(cookies, clientReviewId);
    const body = (await get("/account/export", cookies)).json() as { reviews: { undoneAt: string | null }[] };
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]!.undoneAt).toEqual(expect.any(String));
  });
});
