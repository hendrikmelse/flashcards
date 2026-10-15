import { asc, eq, isNull } from "drizzle-orm";
import { REPORT_REASON_LABELS } from "@flashcards/shared";
import { cardReports, users } from "../db/schema.js";
import type { Db } from "../db/types.js";
import type { Mailer } from "../mail/mailer.js";
import { openFeedbackDigestMessage, type DigestReport } from "../mail/templates.js";
import { reportViews } from "../routes/reports.js";

/** When the digest goes out: 7am on the owner's clock, which is in Los Angeles. */
export const DIGEST_TIME_ZONE = "America/Los_Angeles";
export const DIGEST_HOUR = 7;

// What the zone's clock reads at an instant, as if that reading were UTC.
function wallClockAsUtc(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
}

/** The next time after `now` that the zone's clock reads `hour`:00. */
export function nextDailyTime(now: Date, hour = DIGEST_HOUR, timeZone = DIGEST_TIME_ZONE): Date {
  const t = now.getTime();
  const today = new Date(wallClockAsUtc(t, timeZone));
  // Walk forward a day at a time from today's date on the zone's calendar. The offset is looked up
  // at each candidate (daylight saving moves it), and 7am is never inside a clock change.
  for (let day = 0; day <= 2; day++) {
    const wall = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + day, hour);
    let at = wall - (wallClockAsUtc(wall, timeZone) - wall);
    at = wall - (wallClockAsUtc(at, timeZone) - at);
    if (at > t) return new Date(at);
  }
  throw new Error("unreachable: no daily time within three days");
}

/** Everything still open, ready for the email. */
export async function loadOpenFeedback(db: Db): Promise<DigestReport[]> {
  const rows = await db
    .select({ report: cardReports, email: users.email })
    .from(cardReports)
    .leftJoin(users, eq(cardReports.userId, users.id))
    .where(isNull(cardReports.resolvedAt))
    .orderBy(asc(cardReports.createdAt), asc(cardReports.id));
  const views = await reportViews(db, rows.map((r) => r.report));

  return views.map((v, i) => {
    const row = rows[i]!;
    const lemmas = (side: typeof v.front) => side.map((e) => e.lemma).join(", ");
    return {
      id: v.id,
      kind: v.kind,
      subject: v.kind === "card" ? `${lemmas(v.front)} → ${lemmas(v.back)} (${v.fromLanguage}→${v.toLanguage})` : v.title,
      problem: v.reason ? REPORT_REASON_LABELS[v.reason] : undefined,
      note: v.note,
      reporter: row.email,
      createdAt: row.report.createdAt,
      comments: v.comments.map((c) => ({ fromAdmin: c.fromAdmin, body: c.body })),
    };
  });
}

/** Emails the owner what is open. Sends nothing, and returns false, when nothing is. */
export async function sendFeedbackDigest(
  { db, mailer, to, publicUrl }: { db: Db; mailer: Mailer; to: string; publicUrl: string },
  now = new Date(),
): Promise<boolean> {
  const reports = await loadOpenFeedback(db);
  if (reports.length === 0) return false;
  await mailer.send(openFeedbackDigestMessage(to, { reports, publicUrl, now }));
  return true;
}

/**
 * Sends the digest every day at 7am Los Angeles time for as long as the process runs. A failure is
 * logged and the next day's digest still goes out. The timer is cleared by the returned function.
 */
export function scheduleFeedbackDigest(
  deps: { db: Db; mailer: Mailer; to: string; publicUrl: string },
  log: { info: (o: object, msg: string) => void; error: (o: object, msg: string) => void },
  now: () => Date = () => new Date(),
): () => void {
  let timer: NodeJS.Timeout | undefined;
  const arm = (after: Date) => {
    const at = nextDailyTime(after);
    timer = setTimeout(async () => {
      try {
        const sent = await sendFeedbackDigest(deps, now());
        log.info({ sent }, sent ? "sent the open feedback digest" : "no open feedback, no digest sent");
      } catch (err) {
        log.error({ err }, "could not send the open feedback digest");
      }
      // A timer can fire a moment early; counting from the time it was set for avoids sending twice.
      arm(new Date(Math.max(at.getTime(), now().getTime())));
    }, Math.max(0, at.getTime() - now().getTime()));
    timer.unref();
  };
  arm(now());
  return () => clearTimeout(timer);
}
