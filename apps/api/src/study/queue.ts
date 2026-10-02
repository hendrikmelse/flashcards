import { and, asc, count, eq, exists, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { EntryView } from "@flashcards/shared";
import { loadEntries, loadSentences, sentenceKey } from "../content/queries.js";
import { reviewLogs, userCards, users } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { studyDayStart } from "./day.js";

// Learning cards due within this window are offered now, so a card rated
// "Again" can come back during the same session.
export const LEARN_AHEAD_MS = 20 * 60 * 1000;

const reverse = alias(userCards, "reverse");

export interface StudyCard {
  id: string;
  conceptId: string;
  fromLanguage: string;
  toLanguage: string;
  state: string;
  dueAt: Date;
  front: EntryView[];
  back: EntryView[];
  sentences: { front: string[]; back: string[] };
}

export interface StudyBatch {
  now: Date;
  counts: { learning: number; review: number; new: number };
  cards: StudyCard[];
}

export async function getStudyBatch(
  db: Db,
  userId: string,
  opts: { limit: number; fromLanguage?: string; toLanguage?: string },
  now: Date,
): Promise<StudyBatch> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");

  const mine = and(
    eq(userCards.userId, userId),
    opts.fromLanguage ? eq(userCards.fromLanguage, opts.fromLanguage) : undefined,
    opts.toLanguage ? eq(userCards.toLanguage, opts.toLanguage) : undefined,
  );
  const learningDue = and(
    mine,
    inArray(userCards.state, ["learning", "relearning"]),
    lte(userCards.dueAt, new Date(now.getTime() + LEARN_AHEAD_MS)),
  );
  const reviewDue = and(
    mine,
    eq(userCards.state, "review"),
    lte(userCards.dueAt, now),
  );
  const isNew = and(mine, eq(userCards.state, "new"));

  // The daily new-card limit is global, not per direction: it counts every
  // card the user saw for the first time since the study day began.
  const [{ n: introducedToday } = { n: 0 }] = await db
    .select({ n: count() })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, userId),
        eq(reviewLogs.stateBefore, "new"),
        gte(reviewLogs.reviewedAt, studyDayStart(now, user.timezone)),
      ),
    );
  const newAllowed = Math.max(0, user.dailyNewCardLimit - introducedToday);

  const countWhere = async (where: ReturnType<typeof and>) => {
    const [row] = await db.select({ n: count() }).from(userCards).where(where);
    return row?.n ?? 0;
  };
  const counts = {
    learning: await countWhere(learningDue),
    review: await countWhere(reviewDue),
    new: Math.min(newAllowed, await countWhere(isNew)),
  };

  // Fill the batch in priority order: time-sensitive learning cards, then
  // overdue reviews (most overdue first), then new cards.
  const rows: (typeof userCards.$inferSelect)[] = [];
  // A new card whose reverse (same word, other direction) is in review, or relearning
  // after a lapse, comes before other new cards: you have known the word one way, so
  // learn it the other way now. A reverse still in its first learning steps doesn't count.
  const reverseInReview = exists(
    db
      .select({ one: sql`1` })
      .from(reverse)
      .where(
        and(
          eq(reverse.userId, userCards.userId),
          eq(reverse.conceptId, userCards.conceptId),
          eq(reverse.fromLanguage, userCards.toLanguage),
          eq(reverse.toLanguage, userCards.fromLanguage),
          inArray(reverse.state, ["review", "relearning"]),
        ),
      ),
  );
  const take = (where: ReturnType<typeof and>, n: number, order: "due" | "added") =>
    db
      .select()
      .from(userCards)
      .where(where)
      .orderBy(
        ...(order === "due"
          ? [asc(userCards.dueAt), asc(userCards.id)]
          : [
              sql`(case when ${reverseInReview} then 0 else 1 end)`,
              asc(userCards.addedAt),
              asc(userCards.sortKey),
              asc(userCards.id),
            ]),
      )
      .limit(n);

  rows.push(...(await take(learningDue, opts.limit, "due")));
  if (rows.length < opts.limit) {
    rows.push(...(await take(reviewDue, opts.limit - rows.length, "due")));
  }
  const newRoom = Math.min(opts.limit - rows.length, newAllowed);
  if (newRoom > 0) rows.push(...(await take(isNew, newRoom, "added")));

  const conceptIds = [...new Set(rows.map((r) => r.conceptId))];
  const languages = [...new Set(rows.flatMap((r) => [r.fromLanguage, r.toLanguage]))];
  const entryMap = await loadEntries(db, conceptIds, languages);
  const sentenceMap = await loadSentences(db, conceptIds, languages);

  const cards = rows.map((r): StudyCard => {
    const es = entryMap.get(r.conceptId) ?? [];
    return {
      id: r.id,
      conceptId: r.conceptId,
      fromLanguage: r.fromLanguage,
      toLanguage: r.toLanguage,
      state: r.state,
      dueAt: r.dueAt,
      front: es.filter((e) => e.language === r.fromLanguage),
      back: es.filter((e) => e.language === r.toLanguage),
      sentences: {
        front: sentenceMap.get(sentenceKey(r.conceptId, r.fromLanguage)) ?? [],
        back: sentenceMap.get(sentenceKey(r.conceptId, r.toLanguage)) ?? [],
      },
    };
  });

  return { now, counts, cards };
}
