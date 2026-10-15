import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { seed } from "../src/db/seed.js";
import * as schema from "../src/db/schema.js";
import { cardReports, concepts, reportComments, users } from "../src/db/schema.js";
import { createMemoryMailer } from "../src/mail/mailer.js";
import { nextDailyTime, scheduleFeedbackDigest, sendFeedbackDigest } from "../src/reports/digest.js";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let userId: string;
let conceptId: string;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);
  const [u] = await db.insert(users).values({ email: "reporter@example.com", passwordHash: "x" }).returning({ id: users.id });
  userId = u!.id;
  conceptId = (await db.select({ id: concepts.id }).from(concepts).limit(1))[0]!.id;
}, 60_000);

afterAll(async () => {
  await pg.close();
});

afterEach(async () => {
  await db.delete(cardReports);
});

const deps = (mailer = createMemoryMailer()) => ({ db, mailer, to: "owner@example.com", publicUrl: "https://app.test" });

describe("the daily feedback email", () => {
  it("sends nothing when no feedback is open", async () => {
    const d = deps();
    await db.insert(cardReports).values({ userId, kind: "bug", title: "Done", note: "Fixed", resolvedAt: new Date() });
    expect(await sendFeedbackDigest(d)).toBe(false);
    expect(d.mailer.sent).toHaveLength(0);
  });

  it("sums up everything open in one email, by kind, and leaves resolved reports out", async () => {
    const d = deps();
    await db.insert(cardReports).values([
      { userId, kind: "bug", title: "Cards freeze", note: "After Again." },
      { userId, kind: "suggestion", title: "Offline mode", note: "For the train." },
      { userId, kind: "pack_request", title: "Cooking verbs", note: "" },
      { userId, kind: "card", conceptId, fromLanguage: "en", toLanguage: "nl", reason: "translation", note: "Wrong word." },
      { userId, kind: "bug", title: "Old and fixed", note: "Gone.", resolvedAt: new Date() },
    ]);
    expect(await sendFeedbackDigest(d)).toBe(true);

    expect(d.mailer.sent).toHaveLength(1);
    const mail = d.mailer.sent[0]!;
    expect(mail.to).toBe("owner@example.com");
    expect(mail.subject).toBe("Open feedback: 4 open reports, 4 to answer");
    for (const text of ["Cards freeze", "After Again.", "Offline mode", "For the train.", "Cooking verbs", "Wrong word.", "The translation is wrong"]) {
      expect(mail.text).toContain(text);
    }
    expect(mail.text).toContain("reporter@example.com");
    expect(mail.text).toContain("Problems with words (1)");
    expect(mail.text).toContain("https://app.test/admin");
    expect(mail.text).not.toContain("Old and fixed");
  });

  it("says which reports are waiting for a reply and shows what the sender added", async () => {
    const d = deps();
    const [answered, followedUp] = await db
      .insert(cardReports)
      .values([
        { userId, kind: "bug", title: "Answered bug", note: "n" },
        { userId, kind: "bug", title: "Followed-up bug", note: "n" },
      ])
      .returning({ id: cardReports.id });
    // One at a time, as they arrive: comments inserted together share a timestamp and so an order.
    await db.insert(reportComments).values({ reportId: answered!.id, body: "Looking into it", fromAdmin: true });
    await db.insert(reportComments).values({ reportId: followedUp!.id, body: "Looking into it", fromAdmin: true });
    await db.insert(reportComments).values({ reportId: followedUp!.id, body: "Still broken today", fromAdmin: false });
    await sendFeedbackDigest(d);

    const mail = d.mailer.sent[0]!;
    expect(mail.subject).toBe("Open feedback: 2 open reports, 1 to answer");
    expect(mail.text).toMatch(/Answered bug\n.*replied/);
    expect(mail.text).toMatch(/Followed-up bug\n.*needs a reply/);
    expect(mail.text).toContain("Still broken today");
  });

  it("copes with a report whose sender deleted their account, and shortens long details", async () => {
    const d = deps();
    await db.insert(cardReports).values({ userId: null, kind: "bug", title: "Orphan", note: "x".repeat(2000) });
    await sendFeedbackDigest(d);
    const text = d.mailer.sent[0]!.text;
    expect(text).toContain("a deleted account");
    expect(text).not.toContain("x".repeat(400));
  });

  it("does not send anything when a report comes in", async () => {
    const d = deps();
    await db.insert(cardReports).values({ userId, kind: "bug", title: "Quiet", note: "n" });
    expect(d.mailer.sent).toHaveLength(0);
  });
});

describe("nextDailyTime (7am in Los Angeles)", () => {
  const at = (iso: string) => nextDailyTime(new Date(iso)).toISOString();

  it("is 7am PST (15:00 UTC) in winter and 7am PDT (14:00 UTC) in summer", () => {
    expect(at("2026-01-15T00:00:00Z")).toBe("2026-01-15T15:00:00.000Z");
    expect(at("2026-07-15T00:00:00Z")).toBe("2026-07-15T14:00:00.000Z");
  });

  it("is the next day once 7am has passed, and never the instant it is asked at", () => {
    expect(at("2026-01-15T15:00:01Z")).toBe("2026-01-16T15:00:00.000Z");
    expect(at("2026-01-15T15:00:00Z")).toBe("2026-01-16T15:00:00.000Z");
    expect(at("2026-01-15T14:59:59Z")).toBe("2026-01-15T15:00:00.000Z");
  });

  it("follows the Los Angeles calendar day, not the UTC one", () => {
    // 05:00 UTC on 16 Jan is still the night of the 15th in Los Angeles.
    expect(at("2026-01-16T05:00:00Z")).toBe("2026-01-16T15:00:00.000Z");
  });

  it("stays at 7am across the clock changes", () => {
    // Clocks go forward on 8 March 2026 and back on 1 November 2026.
    expect(at("2026-03-07T20:00:00Z")).toBe("2026-03-08T14:00:00.000Z");
    expect(at("2026-03-08T20:00:00Z")).toBe("2026-03-09T14:00:00.000Z");
    expect(at("2026-10-31T20:00:00Z")).toBe("2026-11-01T15:00:00.000Z");
    expect(at("2026-11-01T20:00:00Z")).toBe("2026-11-02T15:00:00.000Z");
  });
});

describe("scheduleFeedbackDigest", () => {
  afterEach(() => vi.useRealTimers());
  const log = { info: vi.fn(), error: vi.fn() };

  it("sends at 7am, again the next morning, and stops when told to", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-15T10:00:00Z") });
    const d = deps();
    await db.insert(cardReports).values({ userId, kind: "bug", title: "Scheduled", note: "n" });
    const stop = scheduleFeedbackDigest(d, log);

    await vi.advanceTimersByTimeAsync(4 * 3_600_000); // 14:00 UTC, an hour before 7am
    expect(d.mailer.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3_600_000 + 1);
    expect(d.mailer.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(d.mailer.sent).toHaveLength(2);

    stop();
    await vi.advanceTimersByTimeAsync(48 * 3_600_000);
    expect(d.mailer.sent).toHaveLength(2);
  });

  it("logs a failure and still sends the next day", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-15T10:00:00Z") });
    const sent: string[] = [];
    let fail = true;
    const mailer = {
      send: async (e: { subject: string }) => {
        if (fail) throw new Error("provider down");
        sent.push(e.subject);
      },
    };
    await db.insert(cardReports).values({ userId, kind: "bug", title: "Retry", note: "n" });
    const stop = scheduleFeedbackDigest({ ...deps(), mailer }, log);

    await vi.advanceTimersByTimeAsync(5 * 3_600_000 + 1);
    expect(log.error).toHaveBeenCalled();
    fail = false;
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(sent).toHaveLength(1);
    stop();
  });
});
