import { and, count, eq, gte, sql } from "drizzle-orm";
import type { DirectionSummary, StatsResponse } from "@flashcards/shared";
import { reviewLogs, userCards, users } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { isValidTimeZone, studyDayStart } from "./day.js";
import { getStudyCounts } from "./queue.js";

export async function getStats(
  db: Db,
  userId: string,
  now: Date,
): Promise<StatsResponse> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");
  const tz = isValidTimeZone(user.timezone) ? user.timezone : "UTC";

  const [{ n: reviewsToday } = { n: 0 }] = await db
    .select({ n: count() })
    .from(reviewLogs)
    .where(and(eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, studyDayStart(now, tz))));

  const nowIso = now.toISOString();
  const rows = await db
    .select({
      fromLanguage: userCards.fromLanguage,
      toLanguage: userCards.toLanguage,
      total: count(),
      new: sql<number>`count(*) filter (where ${userCards.state} = 'new')`.mapWith(Number),
      learning:
        sql<number>`count(*) filter (where ${userCards.state} in ('learning', 'relearning'))`.mapWith(
          Number,
        ),
      review: sql<number>`count(*) filter (where ${userCards.state} = 'review')`.mapWith(Number),
      dueNow:
        sql<number>`count(*) filter (where ${userCards.state} <> 'new' and ${userCards.dueAt} <= ${nowIso}::timestamptz)`.mapWith(
          Number,
        ),
      nextDueAt: sql<string | null>`min(${userCards.dueAt}) filter (where ${userCards.state} <> 'new' and ${userCards.dueAt} > ${nowIso}::timestamptz)`,
    })
    .from(userCards)
    .where(eq(userCards.userId, userId))
    .groupBy(userCards.fromLanguage, userCards.toLanguage)
    .orderBy(userCards.fromLanguage, userCards.toLanguage);
  const directions: DirectionSummary[] = await Promise.all(
    rows.map(async (r) => {
      // The same counts a session in this direction would use.
      const { counts } = await getStudyCounts(
        db,
        userId,
        { fromLanguage: r.fromLanguage, toLanguage: r.toLanguage },
        now,
      );
      return { ...r, nextDueAt: r.nextDueAt ? new Date(r.nextDueAt).toISOString() : null, ready: counts };
    }),
  );
  const nextDueAt = directions
    .map((d) => d.nextDueAt)
    .filter((d): d is string => d !== null)
    .sort()[0];

  return {
    now: nowIso,
    reviewsToday,
    nextDueAt: nextDueAt ?? null,
    directions,
  };
}
