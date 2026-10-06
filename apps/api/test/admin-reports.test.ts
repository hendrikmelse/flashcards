import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import * as schema from "../src/db/schema.js";
import { cardReports, concepts, reportComments, reviewLogs, userCards, users } from "../src/db/schema.js";

let app: FastifyInstance;
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let conceptId: string;
let admin: { session: string };
let member: { session: string };

const register = async (email: string) => {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "correct horse battery" },
  });
  return { session: res.cookies.find((c) => c.name === "session")!.value, id: res.json().user.id as string };
};
const list = (c: { session: string } | null) =>
  app.inject({ method: "GET", url: "/admin/reports", ...(c ? { cookies: c } : {}) });
const patch = (id: string, payload: unknown, c: { session: string } | null = admin) =>
  app.inject({ method: "PATCH", url: `/admin/reports/${id}`, payload: payload as object, ...(c ? { cookies: c } : {}) });

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);
  app = await buildApp({ db, logger: false, authRateLimit: 1000 });
  const a = await register("admin@example.com");
  await db.update(users).set({ role: "admin" }).where(eq(users.id, a.id));
  admin = { session: a.session };
  member = { session: (await register("member@example.com")).session };
  const [first] = await db.select({ id: concepts.id }).from(concepts).limit(1);
  conceptId = first!.id;
});

afterAll(async () => {
  await app.close();
  await pg.close();
});

const send = (c: { session: string }, payload: object) =>
  app.inject({ method: "POST", url: `/concepts/${conceptId}/report`, payload, cookies: c });
const word = { fromLanguage: "en", toLanguage: "nl", reason: "translation" };
const find = async (note: string) => (await db.select().from(cardReports).where(eq(cardReports.note, note)))[0]!;

describe("account types", () => {
  it("are users unless made admins, and /auth/me says which", async () => {
    const me = async (c: { session: string }) =>
      (await app.inject({ method: "GET", url: "/auth/me", cookies: c })).json().user.role;
    expect(await me(member)).toBe("user");
    expect(await me(admin)).toBe("admin");
  });
});

describe("GET /admin/reports", () => {
  it("is for admins only", async () => {
    expect((await list(null)).statusCode).toBe(401);
    expect((await list(member)).statusCode).toBe(403);
    expect((await list(admin)).statusCode).toBe(200);
  });

  it("lists everyone's reports, newest first, with who sent each and their account type", async () => {
    await send(member, { ...word, note: "From a member" });
    await send(admin, { ...word, note: "From an admin" });
    await app.inject({
      method: "POST",
      url: "/reports",
      payload: { kind: "bug", title: "A bug", note: "Details" },
      cookies: member,
    });
    const reports = (await list(admin)).json().reports as {
      note: string;
      kind: string;
      reporter: { email: string; role: string } | null;
    }[];
    const byNote = (n: string) => reports.find((r) => r.note === n)!;
    expect(byNote("From a member")).toMatchObject({ kind: "card", reporter: { email: "member@example.com", role: "user" } });
    expect(byNote("From an admin").reporter).toMatchObject({ email: "admin@example.com", role: "admin" });
    expect(byNote("Details")).toMatchObject({ kind: "bug", reporter: { email: "member@example.com", role: "user" } });
    // Newest first.
    expect(reports.indexOf(byNote("Details"))).toBeLessThan(reports.indexOf(byNote("From a member")));
  });

  it("still lists a report whose sender deleted their account, without a sender", async () => {
    const gone = await register("gone@example.com");
    await send(gone, { ...word, note: "From someone who left" });
    await app.inject({ method: "POST", url: "/account/delete", payload: { password: "correct horse battery" }, cookies: gone });
    const reports = (await list(admin)).json().reports as { note: string; reporter: unknown }[];
    expect(reports.find((r) => r.note === "From someone who left")!.reporter).toBeNull();
  });
});

const reply = (id: string, payload: unknown, c: { session: string } | null = admin) =>
  app.inject({ method: "POST", url: `/admin/reports/${id}/comments`, payload: payload as object, ...(c ? { cookies: c } : {}) });
const commentsOf = (id: string) => db.select().from(reportComments).where(eq(reportComments.reportId, id));

describe("POST /admin/reports/:id/comments", () => {
  it("is for admins only", async () => {
    await send(member, { ...word, note: "Guarded reply" });
    const r = await find("Guarded reply");
    expect((await reply(r.id, { body: "Hi" }, null)).statusCode).toBe(401);
    expect((await reply(r.id, { body: "Hi" }, member)).statusCode).toBe(403);
    expect(await commentsOf(r.id)).toHaveLength(0);
  });

  it("adds a reply to the conversation, which the sender sees in order with their own comments", async () => {
    await send(member, { ...word, note: "Talk to me" });
    const r = await find("Talk to me");
    await app.inject({ method: "POST", url: `/reports/${r.id}/comments`, payload: { body: "First, from me" }, cookies: member });
    expect((await reply(r.id, { body: "  Thanks, looking.  " })).statusCode).toBe(201);
    await app.inject({ method: "POST", url: `/reports/${r.id}/comments`, payload: { body: "Second, from me" }, cookies: member });

    const mine = (await app.inject({ method: "GET", url: "/reports", cookies: member })).json().reports as {
      note: string;
      comments: { body: string; fromAdmin: boolean }[];
    }[];
    expect(mine.find((x) => x.note === "Talk to me")!.comments.map((c) => [c.body, c.fromAdmin])).toEqual([
      ["First, from me", false],
      ["Thanks, looking.", true],
      ["Second, from me", false],
    ]);
  });

  it("refuses an empty or over-long reply, a bad id, and an unknown report", async () => {
    await send(member, { ...word, note: "Reply validation" });
    const r = await find("Reply validation");
    expect((await reply(r.id, { body: "   " })).statusCode).toBe(400);
    expect((await reply(r.id, { body: "x".repeat(1001) })).statusCode).toBe(400);
    expect((await reply("nope", { body: "hi" })).statusCode).toBe(400);
    expect((await reply("00000000-0000-4000-8000-000000000000", { body: "hi" })).statusCode).toBe(404);
  });
});

describe("PATCH /admin/reports/:id", () => {
  it("is for admins only, and leaves the report alone otherwise", async () => {
    await send(member, { ...word, note: "Guarded" });
    const r = await find("Guarded");
    await reply(r.id, { body: "An answer" });
    expect((await patch(r.id, { resolved: true }, null)).statusCode).toBe(401);
    expect((await patch(r.id, { resolved: true }, member)).statusCode).toBe(403);
    expect((await find("Guarded")).resolvedAt).toBeNull();
  });

  it("will not resolve a report nobody has replied to", async () => {
    await send(member, { ...word, note: "Unanswered" });
    const r = await find("Unanswered");
    expect((await patch(r.id, { resolved: true })).statusCode).toBe(409);
    expect((await find("Unanswered")).resolvedAt).toBeNull();
    // A comment from the sender is not an answer.
    await app.inject({ method: "POST", url: `/reports/${r.id}/comments`, payload: { body: "Hello?" }, cookies: member });
    expect((await patch(r.id, { resolved: true })).statusCode).toBe(409);
    await reply(r.id, { body: "Here you go" });
    expect((await patch(r.id, { resolved: true })).statusCode).toBe(200);
  });

  it("resolves, keeps the first resolved date when resolved again, and reopens", async () => {
    await send(member, { ...word, note: "To resolve" });
    const r = await find("To resolve");
    await reply(r.id, { body: "Done" });
    await patch(r.id, { resolved: true });
    const first = await find("To resolve");
    expect(first.resolvedAt).not.toBeNull();

    await patch(r.id, { resolved: true });
    expect((await find("To resolve")).resolvedAt!.getTime()).toBe(first.resolvedAt!.getTime());

    await patch(r.id, { resolved: false });
    expect((await find("To resolve")).resolvedAt).toBeNull();
    expect(await commentsOf(r.id)).toHaveLength(1); // the conversation is kept
  });

  it("refuses an empty change and a bad id, and says so for an unknown report", async () => {
    await send(member, { ...word, note: "Validated" });
    const r = await find("Validated");
    expect((await patch(r.id, {})).statusCode).toBe(400);
    expect((await patch("nope", { resolved: true })).statusCode).toBe(400);
    expect((await patch("00000000-0000-4000-8000-000000000000", { resolved: true })).statusCode).toBe(404);
  });
});

describe("GET /admin/stats", () => {
  const stats = (c: { session: string } | null) =>
    app.inject({ method: "GET", url: "/admin/stats", ...(c ? { cookies: c } : {}) });

  it("is for admins only", async () => {
    expect((await stats(null)).statusCode).toBe(401);
    expect((await stats(member)).statusCode).toBe(403);
    expect((await stats(admin)).statusCode).toBe(200);
  });

  it("counts accounts, who studied in the last 7 days, reviews, and open reports by type", async () => {
    const before = (await stats(admin)).json();

    const [card] = await db.select().from(concepts).limit(1);
    const studier = await register("studier@example.com");
    const quiet = await register("quiet@example.com"); // has an old review only
    const [studierCard] = await db
      .insert(userCards)
      .values({ userId: studier.id, conceptId: card!.id, fromLanguage: "en", toLanguage: "nl" })
      .returning();
    const [quietCard] = await db
      .insert(userCards)
      .values({ userId: quiet.id, conceptId: card!.id, fromLanguage: "nl", toLanguage: "en" })
      .returning();
    const review = (userId: string, userCardId: string, reviewedAt: Date) => ({
      userId,
      userCardId,
      clientReviewId: crypto.randomUUID(),
      rating: "good" as const,
      reviewedAt,
      stateBefore: "new" as const,
      stateAfter: "learning" as const,
      intervalBeforeDays: 0,
      intervalAfterDays: 0,
      dueAfter: new Date(),
    });
    const day = 86_400_000;
    await db.insert(reviewLogs).values([
      review(studier.id, studierCard!.id, new Date()),
      review(studier.id, studierCard!.id, new Date(Date.now() - 2 * day)),
      review(quiet.id, quietCard!.id, new Date(Date.now() - 30 * day)),
    ]);
    await send(member, { ...word, note: "Counted word problem" });
    await app.inject({
      method: "POST",
      url: "/reports",
      payload: { kind: "bug", title: "Counted bug", note: "x" },
      cookies: member,
    });
    await app.inject({
      method: "POST",
      url: "/reports",
      payload: { kind: "suggestion", title: "Resolved idea", note: "x" },
      cookies: member,
    });
    await db.update(cardReports).set({ resolvedAt: new Date() }).where(eq(cardReports.title, "Resolved idea"));
    await app.inject({
      method: "POST",
      url: "/reports",
      payload: { kind: "pack_request", title: "Counted pack", note: "x" },
      cookies: member,
    });

    const after = (await stats(admin)).json();
    expect(after.accounts - before.accounts).toBe(2);
    expect(after.activeAccounts - before.activeAccounts).toBe(1);
    expect(after.reviews.total - before.reviews.total).toBe(3);
    expect(after.reviews.lastWeek - before.reviews.lastWeek).toBe(2);
    expect(after.openReports.byKind.card - before.openReports.byKind.card).toBe(1);
    expect(after.openReports.byKind.bug - before.openReports.byKind.bug).toBe(1);
    expect(after.openReports.byKind.suggestion).toBe(before.openReports.byKind.suggestion); // resolved: not counted
    expect(after.openReports.byKind.pack_request - before.openReports.byKind.pack_request).toBe(1);
    expect(after.openReports.total).toBe(
      after.openReports.byKind.card +
        after.openReports.byKind.bug +
        after.openReports.byKind.suggestion +
        after.openReports.byKind.pack_request,
    );
  });
});
