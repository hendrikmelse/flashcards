import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { insertUserCards } from "../src/content/queries.js";
import * as schema from "../src/db/schema.js";
import { concepts, languages } from "../src/db/schema.js";
import { seedLanguages } from "../src/db/seed.js";

// The study response says whether this is the user's very first session, which the web app uses to
// open it with an explanation of how studying works.

let app: FastifyInstance;
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let conceptIds: string[];

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

type Study = { firstSession: boolean; cards: { id: string }[] };
const study = async (cookies: { session: string }, query = "") =>
  (await app.inject({ method: "GET", url: `/study?limit=50${query}`, cookies })).json() as Study;
const answer = (cookies: { session: string }, id: string) =>
  app.inject({
    method: "POST",
    url: "/reviews",
    payload: { userCardId: id, clientReviewId: crypto.randomUUID(), rating: "good" },
    cookies,
  });

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seedLanguages(db);
  await db.insert(languages).values({ code: "fr", name: "Français" });
  conceptIds = (
    await db
      .insert(concepts)
      .values(Array.from({ length: 3 }, (_, i) => ({ key: `w-${i}`, gloss: `w ${i}` })))
      .returning({ id: concepts.id })
  ).map((c) => c.id);
  app = await buildApp({ db, logger: false, authRateLimit: 1000 });
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

const cardsFor = (userId: string, from: string, to: string, n = 2) =>
  insertUserCards(db, userId, conceptIds.slice(0, n).map((conceptId, i) => ({ conceptId, sortKey: i })), from, to);

describe("firstSession", () => {
  it("is true for someone who has never answered a card, however often they ask", async () => {
    const u = await newUser("fresh@example.com");
    await cardsFor(u.id, "en", "nl");
    expect((await study(u.cookies)).firstSession).toBe(true);
    expect((await study(u.cookies)).firstSession).toBe(true);
  });

  it("is false once a card has been answered", async () => {
    const u = await newUser("answered@example.com");
    await cardsFor(u.id, "en", "nl");
    const { cards } = await study(u.cookies);
    expect((await answer(u.cookies, cards[0]!.id)).statusCode).toBe(200);
    expect((await study(u.cookies)).firstSession).toBe(false);
  });

  it("counts an answer in any language pair, not just the one being asked about", async () => {
    const u = await newUser("other-pair@example.com");
    await cardsFor(u.id, "en", "nl");
    await cardsFor(u.id, "en", "fr");
    const french = (await study(u.cookies, "&pair=en-fr")).cards;
    await answer(u.cookies, french[0]!.id);
    expect((await study(u.cookies, "&pair=en-nl")).firstSession).toBe(false);
  });

  it("is about the user, not everyone: someone else's answers do not count", async () => {
    const a = await newUser("a-studies@example.com");
    const b = await newUser("b-new@example.com");
    await cardsFor(a.id, "en", "nl");
    await cardsFor(b.id, "en", "nl");
    await answer(a.cookies, (await study(a.cookies)).cards[0]!.id);
    expect((await study(a.cookies)).firstSession).toBe(false);
    expect((await study(b.cookies)).firstSession).toBe(true);
  });
});
