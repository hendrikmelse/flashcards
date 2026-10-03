import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import * as schema from "../src/db/schema.js";
import { concepts, userCards, users } from "../src/db/schema.js";

let app: FastifyInstance;
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let cookies: { session: string };
let userId: string;
let conceptIds: string[];

const register = async (email: string, extra: Record<string, unknown> = {}) => {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "correct horse battery", ...extra },
  });
  return {
    status: res.statusCode,
    cookies: { session: res.cookies.find((c) => c.name === "session")?.value ?? "" },
    id: (res.json().user?.id ?? "") as string,
  };
};

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);
  app = await buildApp({ db, logger: false });
  const me = await register("settings@example.com");
  cookies = me.cookies;
  userId = me.id;
  conceptIds = (await db.select().from(concepts)).map((c) => c.id);
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

const get = () => app.inject({ method: "GET", url: "/settings", cookies });
const patch = (payload: unknown) => app.inject({ method: "PATCH", url: "/settings", cookies, payload: payload as object });

describe("GET /settings", () => {
  it("requires authentication", async () => {
    expect((await app.inject({ method: "GET", url: "/settings" })).statusCode).toBe(401);
    expect((await app.inject({ method: "PATCH", url: "/settings", payload: { dailyNewCardLimit: 5 } })).statusCode).toBe(401);
  });

  it("returns the account's email, time zone and daily limit", async () => {
    expect((await get()).json()).toEqual({
      email: "settings@example.com",
      timezone: "UTC",
      dailyNewCardLimit: 20,
    });
  });
});

describe("PATCH /settings: daily new cards", () => {
  it("changes the limit, and the study queue follows", async () => {
    await db
      .insert(userCards)
      .values(
        conceptIds.map((conceptId) => ({ userId, conceptId, fromLanguage: "en", toLanguage: "nl" })),
      );
    const newCards = async () =>
      ((await app.inject({ method: "GET", url: "/study/counts", cookies })).json() as { counts: { new: number } }).counts.new;
    expect(await newCards()).toBe(3);

    const res = await patch({ dailyNewCardLimit: 2 });
    expect(res.statusCode).toBe(200);
    expect(res.json().dailyNewCardLimit).toBe(2);
    expect(await newCards()).toBe(2);

    expect((await patch({ dailyNewCardLimit: 0 })).json().dailyNewCardLimit).toBe(0);
    expect(await newCards()).toBe(0);
    await patch({ dailyNewCardLimit: 20 });
  });

  it("rejects a limit that is negative, fractional, too big or not a number", async () => {
    for (const bad of [-1, 1.5, 201, "10", null]) {
      expect((await patch({ dailyNewCardLimit: bad })).statusCode).toBe(400);
    }
    expect((await patch({ dailyNewCardLimit: 200 })).statusCode).toBe(200);
    expect((await get()).json().dailyNewCardLimit).toBe(200);
    await patch({ dailyNewCardLimit: 20 });
  });
});

describe("PATCH /settings: time zone", () => {
  it("changes the time zone, and leaves the limit alone", async () => {
    const res = await patch({ timezone: "Europe/Amsterdam" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ timezone: "Europe/Amsterdam", dailyNewCardLimit: 20 });
    await patch({ timezone: "UTC" });
  });

  it("rejects an unknown time zone, an empty body and unknown fields", async () => {
    expect((await patch({ timezone: "Mars/Phobos" })).statusCode).toBe(400);
    expect((await patch({ timezone: "" })).statusCode).toBe(400);
    expect((await patch({})).statusCode).toBe(400);
    expect((await patch({ email: "x@example.com" })).statusCode).toBe(400);
    expect((await get()).json().email).toBe("settings@example.com");
  });

  it("moves review cards to the start of the same day in the new zone", async () => {
    const [review] = await db
      .insert(userCards)
      .values([
        // Due at the start of 12 March in UTC (04:00Z), and a learning card that must not move.
        { userId, conceptId: conceptIds[0]!, fromLanguage: "nl", toLanguage: "en", state: "review", dueAt: new Date("2026-03-12T04:00:00Z") },
        { userId, conceptId: conceptIds[1]!, fromLanguage: "nl", toLanguage: "en", state: "learning", dueAt: new Date("2026-03-12T09:30:00Z") },
      ])
      .returning();
    const dueOf = async (id: string) =>
      (await db.select().from(userCards).where(eq(userCards.id, id)))[0]!.dueAt.toISOString();
    const learning = (await db.select().from(userCards).where(eq(userCards.userId, userId))).find(
      (c) => c.state === "learning",
    )!;

    // 04:00 on 12 March in Los Angeles (PDT, UTC-7) is 11:00Z.
    await patch({ timezone: "America/Los_Angeles" });
    expect(await dueOf(review!.id)).toBe("2026-03-12T11:00:00.000Z");
    // Reading the day in Los Angeles and moving to Amsterdam (CET, UTC+1): 04:00 on the 12th is 03:00Z.
    await patch({ timezone: "Europe/Amsterdam" });
    expect(await dueOf(review!.id)).toBe("2026-03-12T03:00:00.000Z");
    // A card still being learned keeps its real-time due date.
    expect(await dueOf(learning.id)).toBe("2026-03-12T09:30:00.000Z");

    // Setting the same zone again changes nothing.
    await patch({ timezone: "Europe/Amsterdam" });
    expect(await dueOf(review!.id)).toBe("2026-03-12T03:00:00.000Z");
    await patch({ timezone: "UTC" });
  });

  it("does not move other users' cards", async () => {
    const other = await register("other-settings@example.com");
    await db.insert(userCards).values({
      userId: other.id,
      conceptId: conceptIds[2]!,
      fromLanguage: "en",
      toLanguage: "nl",
      state: "review",
      dueAt: new Date("2026-03-12T04:00:00Z"),
    });
    await patch({ timezone: "Asia/Tokyo" });
    const theirs = (await db.select().from(userCards).where(eq(userCards.userId, other.id)))[0]!;
    expect(theirs.dueAt.toISOString()).toBe("2026-03-12T04:00:00.000Z");
    await patch({ timezone: "UTC" });
  });
});

describe("registering with a time zone", () => {
  const zoneOf = async (id: string) =>
    (await db.select({ tz: users.timezone }).from(users).where(eq(users.id, id)))[0]!.tz;

  it("keeps the browser's time zone", async () => {
    const r = await register("tz-ok@example.com", { timezone: "America/New_York" });
    expect(r.status).toBe(201);
    expect(await zoneOf(r.id)).toBe("America/New_York");
  });

  it("ignores an unknown one instead of refusing the sign-up", async () => {
    const r = await register("tz-bad@example.com", { timezone: "Not/AZone" });
    expect(r.status).toBe(201);
    expect(await zoneOf(r.id)).toBe("UTC");
  });

  it("stays on UTC when none is given", async () => {
    const r = await register("tz-none@example.com");
    expect(await zoneOf(r.id)).toBe("UTC");
  });
});
