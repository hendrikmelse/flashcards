import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import * as schema from "../src/db/schema.js";
import { cardReports, concepts } from "../src/db/schema.js";

let app: FastifyInstance;
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let cookies: { session: string };
let conceptId: string;

const report = (id: string, payload: unknown, c: { session: string } | null = cookies) =>
  app.inject({ method: "POST", url: `/concepts/${id}/report`, payload: payload as object, ...(c ? { cookies: c } : {}) });
const good = { fromLanguage: "en", toLanguage: "nl", reason: "translation", note: "It should be 'huis'." };

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);
  app = await buildApp({ db, logger: false, authRateLimit: 1000 });
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email: "reporter@example.com", password: "correct horse battery" },
  });
  cookies = { session: res.cookies.find((c) => c.name === "session")!.value };
  const [first] = await db.select({ id: concepts.id }).from(concepts).limit(1);
  conceptId = first!.id;
});

afterAll(async () => {
  await app.close();
  await pg.close();
});

describe("POST /concepts/:id/report", () => {
  it("stores the report with who sent it, the direction and what is wrong", async () => {
    const res = await report(conceptId, good);
    expect(res.statusCode).toBe(201);
    const rows = await db.select().from(cardReports);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      conceptId,
      fromLanguage: "en",
      toLanguage: "nl",
      reason: "translation",
      note: "It should be 'huis'.",
      resolvedAt: null,
    });
  });

  it("needs no note for most reasons, and trims the note", async () => {
    expect((await report(conceptId, { ...good, reason: "forms", note: undefined })).statusCode).toBe(201);
    expect((await report(conceptId, { ...good, reason: "sentence", note: "  odd  " })).statusCode).toBe(201);
    const rows = await db.select().from(cardReports);
    expect(rows.find((r) => r.reason === "forms")?.note).toBe("");
    expect(rows.find((r) => r.reason === "sentence")?.note).toBe("odd");
  });

  it("asks for a note when the reason is something else", async () => {
    expect((await report(conceptId, { ...good, reason: "other", note: "   " })).statusCode).toBe(400);
    expect((await report(conceptId, { ...good, reason: "other", note: "Hmm" })).statusCode).toBe(201);
  });

  it("rejects an unknown reason, a note that is too long and a same-language pair", async () => {
    expect((await report(conceptId, { ...good, reason: "bogus" })).statusCode).toBe(400);
    expect((await report(conceptId, { ...good, note: "x".repeat(1001) })).statusCode).toBe(400);
    expect((await report(conceptId, { ...good, fromLanguage: "fr" })).statusCode).toBe(400);
  });

  it("needs sign-in", async () => {
    expect((await report(conceptId, good, null)).statusCode).toBe(401);
  });

  it("says so for a word that does not exist, or an id that is not one", async () => {
    expect((await report("00000000-0000-4000-8000-000000000000", good)).statusCode).toBe(404);
    expect((await report("nope", good)).statusCode).toBe(400);
  });
});

describe("when the person who sent a report deletes their account", () => {
  it("keeps the report, without the link to them", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "leaving@example.com", password: "correct horse battery" },
    });
    const leaving = { session: reg.cookies.find((c) => c.name === "session")!.value };
    const id = reg.json().user.id as string;
    await report(conceptId, { ...good, note: "Written before leaving" }, leaving);
    const [before] = await db.select().from(cardReports).where(eq(cardReports.note, "Written before leaving"));
    expect(before!.userId).toBe(id);

    const del = await app.inject({
      method: "POST",
      url: "/account/delete",
      payload: { password: "correct horse battery" },
      cookies: leaving,
    });
    expect(del.statusCode).toBe(204);

    const [after] = await db.select().from(cardReports).where(eq(cardReports.note, "Written before leaving"));
    expect(after).toMatchObject({ conceptId, reason: "translation", userId: null });
  });
});

describe("rate limits", () => {
  async function limited(opts: { authRateLimit?: number; publicRateLimit?: number }, run: (app: FastifyInstance) => Promise<number[]>) {
    const small = await buildApp({ db, logger: false, ...opts });
    try {
      return await run(small);
    } finally {
      await small.close();
    }
  }
  const hits = (a: FastifyInstance, url: string, n: number) =>
    (async () => {
      const out: number[] = [];
      for (let i = 0; i < n; i++) out.push((await a.inject({ method: "GET", url })).statusCode);
      return out;
    })();

  it("limits word searches, and the public lists get twice as many", async () => {
    const search = await limited({ publicRateLimit: 3 }, (a) =>
      hits(a, "/concepts/search?q=dog&fromLanguage=en&toLanguage=nl", 5),
    );
    expect(search.filter((s) => s === 200)).toHaveLength(3);
    expect(search.filter((s) => s === 429)).toHaveLength(2);

    const packs = await limited({ publicRateLimit: 3 }, (a) => hits(a, "/packs", 8));
    expect(packs.filter((s) => s === 200)).toHaveLength(6);
    expect(packs.filter((s) => s === 429)).toHaveLength(2);
    const languages = await limited({ publicRateLimit: 3 }, (a) => hits(a, "/languages", 7));
    expect(languages.filter((s) => s === 429)).toHaveLength(1);
  });

  it("limits pack pages too", async () => {
    const [pack] = await db.select({ id: schema.packs.id }).from(schema.packs).limit(1);
    const id = pack!.id;
    const statuses = await limited({ publicRateLimit: 1 }, (a) => hits(a, `/packs/${id}`, 3));
    expect(statuses.filter((s) => s === 429)).toHaveLength(1);
  });

  it("limits problem reports", async () => {
    const small = await buildApp({ db, logger: false, authRateLimit: 2 });
    const reg = await small.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "limited@example.com", password: "correct horse battery" },
    });
    const c = { session: reg.cookies.find((x) => x.name === "session")!.value };
    const send = () =>
      small.inject({ method: "POST", url: `/concepts/${conceptId}/report`, payload: good, cookies: c }).then((r) => r.statusCode);
    expect([await send(), await send(), await send()]).toEqual([201, 201, 429]);
    await small.close();
  });

  it("does not limit the rest of the app that way", async () => {
    const statuses = await limited({ publicRateLimit: 1 }, (a) => hits(a, "/health", 5));
    expect(statuses.every((s) => s !== 429)).toBe(true);
  });
});
