import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import * as schema from "../src/db/schema.js";
import { cardReports, concepts, reportComments } from "../src/db/schema.js";
import { createMemoryMailer, type Mailer } from "../src/mail/mailer.js";

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
  it("stores the report with who sent it, the direction, and what is wrong", async () => {
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

describe("emailing the owner", () => {
  const owner = "owner@example.com";
  async function withNotifier(mailer: Mailer, run: (a: FastifyInstance) => Promise<void>, notify: string | null = owner) {
    const a = await buildApp({ db, logger: false, authRateLimit: 1000, mailer, reportNotifyEmail: notify ?? undefined });
    try {
      await run(a);
    } finally {
      await a.close();
    }
  }
  const send = (a: FastifyInstance, payload: object) =>
    a.inject({ method: "POST", url: `/concepts/${conceptId}/report`, payload, cookies });

  it("sends the owner one email per report, saying who, what, and how to answer", async () => {
    const mailer = createMemoryMailer();
    await withNotifier(mailer, async (a) => {
      expect((await send(a, { ...good, note: "Mail me this" })).statusCode).toBe(201);
    });
    expect(mailer.sent).toHaveLength(1);
    const [row] = await db.select().from(cardReports).where(eq(cardReports.note, "Mail me this"));
    const mail = mailer.sent[0]!;
    expect(mail.to).toBe(owner);
    expect(mail.subject).toMatch(/^Problem report: /);
    expect(mail.text).toContain("reporter@example.com");
    expect(mail.text).toContain("The translation is wrong");
    expect(mail.text).toContain("Mail me this");
    expect(mail.text).toContain(row!.id.slice(0, 8));
  });

  it("sends nothing when no address is set", async () => {
    const mailer = createMemoryMailer();
    await withNotifier(mailer, async (a) => {
      expect((await send(a, good)).statusCode).toBe(201);
    }, null);
    expect(mailer.sent).toHaveLength(0);
  });

  it("does not email for a report that was rejected", async () => {
    const mailer = createMemoryMailer();
    await withNotifier(mailer, async (a) => {
      expect((await send(a, { ...good, reason: "bogus" })).statusCode).toBe(400);
    });
    expect(mailer.sent).toHaveLength(0);
  });

  it("still saves the report and answers normally when the email cannot be sent", async () => {
    const broken: Mailer = { send: () => Promise.reject(new Error("provider down")) };
    await withNotifier(broken, async (a) => {
      expect((await send(a, { ...good, note: "Saved anyway" })).statusCode).toBe(201);
    });
    expect(await db.select().from(cardReports).where(eq(cardReports.note, "Saved anyway"))).toHaveLength(1);
  });
});

describe("GET /reports", () => {
  const mine = () => app.inject({ method: "GET", url: "/reports", cookies });

  it("lists the user’s own reports, newest first, with status and the conversation", async () => {
    await report(conceptId, { ...good, note: "First of mine" });
    await report(conceptId, { ...good, note: "Second of mine" });
    const [firstRow] = await db.select().from(cardReports).where(eq(cardReports.note, "First of mine"));
    await db.insert(reportComments).values([
      { reportId: firstRow!.id, body: "Fixed, thank you!", fromAdmin: true, createdAt: new Date("2026-01-02T10:00:00Z") },
      { reportId: firstRow!.id, body: "Great, thanks.", createdAt: new Date("2026-01-03T10:00:00Z") },
    ]);
    await db.update(cardReports).set({ resolvedAt: new Date() }).where(eq(cardReports.id, firstRow!.id));

    const res = await mine();
    expect(res.statusCode).toBe(200);
    const list = res.json().reports as {
      note: string;
      status: string;
      comments: { body: string; fromAdmin: boolean }[];
      resolvedAt: string | null;
    }[];
    const first = list.find((r) => r.note === "First of mine")!;
    const second = list.find((r) => r.note === "Second of mine")!;
    expect(first.status).toBe("resolved");
    expect(first.comments.map((c) => [c.body, c.fromAdmin])).toEqual([
      ["Fixed, thank you!", true],
      ["Great, thanks.", false],
    ]);
    expect(first.resolvedAt).not.toBeNull();
    expect(second).toMatchObject({ status: "open", comments: [], resolvedAt: null });
    expect(list.indexOf(second)).toBeLessThan(list.indexOf(first));
    expect(res.json().reports[0]).toMatchObject({ conceptId, fromLanguage: "en", toLanguage: "nl", reason: "translation" });
  });

  it("never shows another user’s reports", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "other@example.com", password: "correct horse battery" },
    });
    const other = { session: reg.cookies.find((c) => c.name === "session")!.value };
    expect((await app.inject({ method: "GET", url: "/reports", cookies: other })).json().reports).toEqual([]);
    await report(conceptId, { ...good, note: "Only the other one" }, other);
    const theirs = (await app.inject({ method: "GET", url: "/reports", cookies: other })).json().reports as { note: string }[];
    expect(theirs.map((r) => r.note)).toEqual(["Only the other one"]);
    expect(((await mine()).json().reports as { note: string }[]).some((r) => r.note === "Only the other one")).toBe(false);
  });

  it("needs sign-in", async () => {
    expect((await app.inject({ method: "GET", url: "/reports" })).statusCode).toBe(401);
  });
});

describe("POST /reports (bugs and feature suggestions)", () => {
  const send = (payload: unknown, c: { session: string } | null = cookies) =>
    app.inject({ method: "POST", url: "/reports", payload: payload as object, ...(c ? { cookies: c } : {}) });

  it("stores a bug or a suggestion with its title and details, and no word", async () => {
    expect((await send({ kind: "bug", title: "  Cards freeze ", note: " After Again. " })).statusCode).toBe(201);
    expect((await send({ kind: "suggestion", title: "Dark mode", note: "Easier on the eyes." })).statusCode).toBe(201);
    const bug = (await db.select().from(cardReports).where(eq(cardReports.title, "Cards freeze")))[0]!;
    expect(bug).toMatchObject({ kind: "bug", note: "After Again.", conceptId: null, fromLanguage: null, reason: null, resolvedAt: null });
    const idea = (await db.select().from(cardReports).where(eq(cardReports.title, "Dark mode")))[0]!;
    expect(idea.kind).toBe("suggestion");
  });

  it("needs a title and details, a known kind, and sensible lengths", async () => {
    expect((await send({ kind: "bug", title: "", note: "x" })).statusCode).toBe(400);
    expect((await send({ kind: "bug", title: "x", note: "   " })).statusCode).toBe(400);
    expect((await send({ kind: "card", title: "x", note: "x" })).statusCode).toBe(400);
    expect((await send({ kind: "bug", title: "x".repeat(101), note: "x" })).statusCode).toBe(400);
    expect((await send({ kind: "bug", title: "x", note: "x".repeat(2001) })).statusCode).toBe(400);
  });

  it("needs sign-in", async () => {
    expect((await send({ kind: "bug", title: "x", note: "x" }, null)).statusCode).toBe(401);
  });

  it("emails the owner, saying which kind it is", async () => {
    const mailer = createMemoryMailer();
    const a = await buildApp({ db, logger: false, authRateLimit: 1000, mailer, reportNotifyEmail: "owner@example.com" });
    try {
      const res = await a.inject({ method: "POST", url: "/reports", payload: { kind: "suggestion", title: "Offline mode", note: "For the train." }, cookies });
      expect(res.statusCode).toBe(201);
    } finally {
      await a.close();
    }
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toBe("Feature suggestion: Offline mode");
    expect(mailer.sent[0]!.text).toContain("For the train.");
    expect(mailer.sent[0]!.text).toContain("reporter@example.com");
  });

  it("needs details for a bug or a suggestion, but not for a pack request", async () => {
    const send = (payload: object) => app.inject({ method: "POST", url: "/reports", payload, cookies });
    expect((await send({ kind: "bug", title: "No details" })).statusCode).toBe(400);
    expect((await send({ kind: "suggestion", title: "No details", note: "  " })).statusCode).toBe(400);
    expect((await send({ kind: "pack_request", title: "Just a title" })).statusCode).toBe(201);
    expect((await db.select().from(cardReports).where(eq(cardReports.title, "Just a title")))[0]).toMatchObject({
      kind: "pack_request",
      note: "",
    });
    expect((await send({ kind: "pack_request", title: "  " })).statusCode).toBe(400);
  });

  it("takes a pack request like the others, and emails the owner about it", async () => {
    const mailer = createMemoryMailer();
    const a = await buildApp({ db, logger: false, authRateLimit: 1000, mailer, reportNotifyEmail: "owner@example.com" });
    try {
      const res = await a.inject({
        method: "POST",
        url: "/reports",
        payload: { kind: "pack_request", title: "Cooking verbs", note: "Chop, stir, fry." },
        cookies,
      });
      expect(res.statusCode).toBe(201);
    } finally {
      await a.close();
    }
    const [row] = await db.select().from(cardReports).where(eq(cardReports.title, "Cooking verbs"));
    expect(row).toMatchObject({ kind: "pack_request", conceptId: null, reason: null });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toBe("Pack request: Cooking verbs");
    expect(mailer.sent[0]!.text).toContain("Chop, stir, fry.");
    const list = (await app.inject({ method: "GET", url: "/reports", cookies })).json().reports as { title: string; kind: string }[];
    expect(list.find((r) => r.title === "Cooking verbs")!.kind).toBe("pack_request");
  });

  it("shows up in the sender's list with its kind and title, and no word", async () => {
    await send({ kind: "bug", title: "Listed bug", note: "Details." });
    const list = (await app.inject({ method: "GET", url: "/reports", cookies })).json().reports as Record<string, unknown>[];
    const mine = list.find((r) => r.title === "Listed bug")!;
    expect(mine).toMatchObject({ kind: "bug", note: "Details.", conceptId: null, front: [], back: [], fromLanguage: null, reason: null, status: "open" });
  });

  it("is refused by the database for a word problem that names no word", async () => {
    await expect(db.insert(cardReports).values({ kind: "card", note: "no word" })).rejects.toThrow();
  });
});

describe("POST /reports/:id/comments", () => {
  const comment = (id: string, payload: unknown, c: { session: string } | null = cookies) =>
    app.inject({ method: "POST", url: `/reports/${id}/comments`, payload: payload as object, ...(c ? { cookies: c } : {}) });
  const mine = async (note: string) => {
    await report(conceptId, { ...good, note });
    return (await db.select().from(cardReports).where(eq(cardReports.note, note)))[0]!;
  };

  it("adds a comment to an open report of the sender's, and lists it with the report, oldest first", async () => {
    const r = await mine("Commentable");
    expect((await comment(r.id, { body: "  First thought " })).statusCode).toBe(201);
    expect((await comment(r.id, { body: "Second thought" })).statusCode).toBe(201);
    const list = (await app.inject({ method: "GET", url: "/reports", cookies })).json().reports as { id: string; comments: { body: string }[] }[];
    expect(list.find((x) => x.id === r.id)!.comments.map((c) => c.body)).toEqual(["First thought", "Second thought"]);
  });

  it("refuses an empty or over-long comment", async () => {
    const r = await mine("Commentable 2");
    expect((await comment(r.id, { body: "   " })).statusCode).toBe(400);
    expect((await comment(r.id, { body: "x".repeat(1001) })).statusCode).toBe(400);
    expect((await comment("nope", { body: "hi" })).statusCode).toBe(400);
  });

  it("refuses once the report is resolved", async () => {
    const r = await mine("Commentable 3");
    await db.update(cardReports).set({ resolvedAt: new Date() }).where(eq(cardReports.id, r.id));
    expect((await comment(r.id, { body: "Too late" })).statusCode).toBe(409);
    expect(await db.select().from(reportComments).where(eq(reportComments.reportId, r.id))).toHaveLength(0);
  });

  it("treats someone else's report as not found, and needs sign-in", async () => {
    const r = await mine("Commentable 4");
    const reg = await app.inject({ method: "POST", url: "/auth/register", payload: { email: "snoop@example.com", password: "correct horse battery" } });
    const other = { session: reg.cookies.find((c) => c.name === "session")!.value };
    expect((await comment(r.id, { body: "Not mine" }, other)).statusCode).toBe(404);
    expect((await comment(r.id, { body: "Anon" }, null)).statusCode).toBe(401);
    expect(await db.select().from(reportComments).where(eq(reportComments.reportId, r.id))).toHaveLength(0);
  });

  it("emails the owner about the comment", async () => {
    const r = await mine("Commentable 5");
    const mailer = createMemoryMailer();
    const a = await buildApp({ db, logger: false, authRateLimit: 1000, mailer, reportNotifyEmail: "owner@example.com" });
    try {
      const res = await a.inject({ method: "POST", url: `/reports/${r.id}/comments`, payload: { body: "Extra detail" }, cookies });
      expect(res.statusCode).toBe(201);
    } finally {
      await a.close();
    }
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toMatch(/^New comment on report: /);
    expect(mailer.sent[0]!.text).toContain("Extra detail");
    expect(mailer.sent[0]!.text).toContain(r.id.slice(0, 8));
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
