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
import { concepts, reviewLogs, sessions, userCards, users } from "../src/db/schema.js";

let app: FastifyInstance;
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let conceptIds: string[];

const PASSWORD = "correct horse battery";
type Cookies = { session: string };

async function register(email: string, name?: string) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: PASSWORD, ...(name ? { name } : {}) },
  });
  expect(res.statusCode).toBe(201);
  return {
    id: res.json().user.id as string,
    cookies: { session: res.cookies.find((c) => c.name === "session")!.value } as Cookies,
  };
}

async function login(email: string, password = PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
  return { status: res.statusCode, cookies: { session: res.cookies.find((c) => c.name === "session")?.value ?? "" } as Cookies };
}

const post = (url: string, cookies: Cookies | undefined, payload: unknown) =>
  app.inject({ method: "POST", url, ...(cookies ? { cookies } : {}), payload: payload as object });
const whoAmI = async (cookies: Cookies) =>
  (await app.inject({ method: "GET", url: "/auth/me", cookies })).json().user as { email: string } | null;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);
  app = await buildApp({ db, logger: false, authRateLimit: 1000 }); // this file signs up many users
  conceptIds = (await db.select().from(concepts)).map((c) => c.id);
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

describe("changing the password", () => {
  it("requires being signed in", async () => {
    expect((await post("/account/password", undefined, { currentPassword: "x", newPassword: "longenough" })).statusCode).toBe(401);
  });

  it("refuses the wrong current password, and a new one that is too short", async () => {
    const { cookies } = await register("pw1@example.com");
    expect((await post("/account/password", cookies, { currentPassword: "wrong", newPassword: "a brand new password" })).statusCode).toBe(403);
    expect((await post("/account/password", cookies, { currentPassword: PASSWORD, newPassword: "short" })).statusCode).toBe(400);
    expect((await post("/account/password", cookies, { newPassword: "a brand new password" })).statusCode).toBe(400);
    // Nothing changed.
    expect((await login("pw1@example.com")).status).toBe(200);
  });

  it("changes it: the old password stops working and the new one works", async () => {
    const { cookies } = await register("pw2@example.com");
    const res = await post("/account/password", cookies, { currentPassword: PASSWORD, newPassword: "a brand new password" });
    expect(res.statusCode).toBe(204);
    expect((await login("pw2@example.com")).status).toBe(401);
    expect((await login("pw2@example.com", "a brand new password")).status).toBe(200);
  });

  it("signs out other sessions but keeps this one", async () => {
    const { cookies: here } = await register("pw3@example.com");
    const elsewhere = (await login("pw3@example.com")).cookies;
    expect(await whoAmI(elsewhere)).not.toBeNull();

    await post("/account/password", here, { currentPassword: PASSWORD, newPassword: "a brand new password" });
    expect(await whoAmI(here)).toMatchObject({ email: "pw3@example.com" });
    expect(await whoAmI(elsewhere)).toBeNull();
  });
});

describe("changing the email address", () => {
  it("requires being signed in", async () => {
    expect((await post("/account/email", undefined, { email: "x@example.com", password: PASSWORD })).statusCode).toBe(401);
  });

  it("refuses the wrong password, a bad address, and one already taken", async () => {
    await register("taken@example.com");
    const { cookies } = await register("em1@example.com");
    expect((await post("/account/email", cookies, { email: "new@example.com", password: "wrong" })).statusCode).toBe(403);
    expect((await post("/account/email", cookies, { email: "not-an-email", password: PASSWORD })).statusCode).toBe(400);
    expect((await post("/account/email", cookies, { email: "Taken@Example.com", password: PASSWORD })).statusCode).toBe(409);
    expect(await whoAmI(cookies)).toMatchObject({ email: "em1@example.com" });
  });

  it("only asks for confirmation: the address stays until the link is opened (see email-flows.test.ts)", async () => {
    const { cookies } = await register("em2@example.com", "Em");
    const res = await post("/account/email", cookies, { email: "  Em.New@Example.com ", password: PASSWORD });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ pendingEmail: "em.new@example.com" });
    expect(await whoAmI(cookies)).toMatchObject({ email: "em2@example.com" });
    expect((await login("em2@example.com")).status).toBe(200);
    expect((await login("em.new@example.com")).status).toBe(401);
  });

  it("refuses the address the account already has", async () => {
    const { cookies } = await register("em3@example.com");
    expect((await post("/account/email", cookies, { email: "em3@example.com", password: PASSWORD })).statusCode).toBe(400);
  });
});

describe("deleting the account", () => {
  async function withData(email: string) {
    const me = await register(email);
    const [card] = await db
      .insert(userCards)
      .values({ userId: me.id, conceptId: conceptIds[0]!, fromLanguage: "en", toLanguage: "nl" })
      .returning();
    await db.insert(reviewLogs).values({
      userCardId: card!.id,
      userId: me.id,
      clientReviewId: randomUUID(),
      rating: "good",
      stateBefore: "new",
      stateAfter: "learning",
      intervalBeforeDays: 0,
      intervalAfterDays: 0,
      dueAfter: new Date(),
    });
    return me;
  }
  const rows = async (id: string) => ({
    users: (await db.select().from(users).where(eq(users.id, id))).length,
    cards: (await db.select().from(userCards).where(eq(userCards.userId, id))).length,
    logs: (await db.select().from(reviewLogs).where(eq(reviewLogs.userId, id))).length,
    sessions: (await db.select().from(sessions).where(eq(sessions.userId, id))).length,
  });

  it("requires being signed in, and the right password", async () => {
    expect((await post("/account/delete", undefined, { password: PASSWORD })).statusCode).toBe(401);
    const me = await withData("del1@example.com");
    expect((await post("/account/delete", me.cookies, { password: "wrong" })).statusCode).toBe(403);
    expect((await post("/account/delete", me.cookies, {})).statusCode).toBe(400);
    expect(await rows(me.id)).toMatchObject({ users: 1, cards: 1, logs: 1 });
  });

  it("deletes the account with its cards, history and sessions, and signs out", async () => {
    const me = await withData("del2@example.com");
    const bystander = await withData("bystander@example.com");
    const conceptsBefore = (await db.select().from(concepts)).length;

    const res = await post("/account/delete", me.cookies, { password: PASSWORD });
    expect(res.statusCode).toBe(204);
    expect(res.headers["set-cookie"]).toMatch(/session=;/); // the cookie is cleared

    expect(await rows(me.id)).toEqual({ users: 0, cards: 0, logs: 0, sessions: 0 });
    expect(await whoAmI(me.cookies)).toBeNull();
    expect((await login("del2@example.com")).status).toBe(401);
    // Other people's data and the shared words are untouched.
    expect(await rows(bystander.id)).toMatchObject({ users: 1, cards: 1, logs: 1 });
    expect((await db.select().from(concepts)).length).toBe(conceptsBefore);
  });
});

describe("exporting data", () => {
  it("requires being signed in", async () => {
    expect((await app.inject({ method: "GET", url: "/account/export" })).statusCode).toBe(401);
  });

  it("returns the account, every card and the review history, as a download", async () => {
    const me = await register("export1@example.com", "Ex");
    const other = await register("export2@example.com");
    const [dogCard, houseCard] = await db
      .insert(userCards)
      .values([
        { userId: me.id, conceptId: conceptIds[0]!, fromLanguage: "en", toLanguage: "nl", state: "review", stability: 4.5, lapses: 1 },
        { userId: me.id, conceptId: conceptIds[1]!, fromLanguage: "nl", toLanguage: "en" },
      ])
      .returning();
    await db.insert(userCards).values({ userId: other.id, conceptId: conceptIds[2]!, fromLanguage: "en", toLanguage: "nl" });
    await db.insert(reviewLogs).values({
      userCardId: dogCard!.id,
      userId: me.id,
      clientReviewId: randomUUID(),
      rating: "hard",
      timeTakenMs: 1234,
      stateBefore: "review",
      stateAfter: "review",
      intervalBeforeDays: 3,
      intervalAfterDays: 4,
      dueAfter: new Date("2026-02-01T04:00:00Z"),
    });
    void houseCard;

    const res = await app.inject({ method: "GET", url: "/account/export", cookies: me.cookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="flashcards-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers["cache-control"]).toBe("no-store");

    const body = res.json();
    expect(body.account).toMatchObject({ email: "export1@example.com", name: "Ex", timezone: "UTC", dailyNewCardLimit: 20 });
    expect(body.exportedAt).toEqual(expect.any(String));

    // Both cards, readable without the app: the word key and the words themselves.
    expect(body.cards).toHaveLength(2);
    const dog = body.cards.find((c: { word: string }) => c.word === "dog");
    expect(dog).toMatchObject({ fromLanguage: "en", toLanguage: "nl", state: "review", stability: 4.5, lapses: 1, prompt: ["dog"], answer: ["hond"] });
    const house = body.cards.find((c: { word: string }) => c.word === "house");
    expect(house).toMatchObject({ fromLanguage: "nl", prompt: ["huis"], answer: ["house"] });

    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({
      word: "dog",
      fromLanguage: "en",
      rating: "hard",
      timeTakenMs: 1234,
      intervalBeforeDays: 3,
      intervalAfterDays: 4,
      dueAfter: "2026-02-01T04:00:00.000Z",
    });
  });

  it("holds only the user's own data and never the password", async () => {
    const me = await register("export3@example.com");
    const raw = (await app.inject({ method: "GET", url: "/account/export", cookies: me.cookies })).body;
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("password");
    expect(raw).not.toContain("export1@example.com");
    expect(raw).not.toContain("export2@example.com");
    expect(JSON.parse(raw)).toMatchObject({ cards: [], reviews: [] });
  });
});

describe("guessing the password", () => {
  it("is limited on every route that checks it", async () => {
    // A second app on the same database with a tight limit; the session cookie works in both.
    const strict = await buildApp({ db, logger: false, authRateLimit: 3 });
    try {
      for (const [url, payload] of [
        ["/account/password", { currentPassword: "wrong", newPassword: "a brand new password" }],
        ["/account/email", { email: "someone@example.com", password: "wrong" }],
        ["/account/delete", { password: "wrong" }],
      ] as const) {
        const { cookies } = await register(`limited${url.replace(/\W/g, "")}@example.com`);
        const statuses: number[] = [];
        for (let i = 0; i < 4; i++) {
          statuses.push((await strict.inject({ method: "POST", url, cookies, payload })).statusCode);
        }
        expect(statuses).toEqual([403, 403, 403, 429]);
      }
    } finally {
      await strict.close();
    }
  });
});
