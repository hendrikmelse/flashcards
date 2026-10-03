import { and, asc, count, eq, exists, gte, inArray, lte, max, not, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { EARLY_START_WINDOW_MS, SESSION_GAP_MS, type EntryView, type Scope } from "@flashcards/shared";
import { loadEntries, loadSentences, sentenceKey } from "../content/queries.js";
import { reviewLogs, userCards, users } from "../db/schema.js";
import type { Db } from "../db/types.js";
import type { Scheduler } from "../srs/engine.js";
import { endOfTomorrow, studyDayStart } from "./day.js";
import { interleaveNew } from "./order.js";
import { inPair, inScope, pairOf } from "./scope.js";

// Learning cards due within this window are offered now, so a card rated
// "Again" can come back during the same session.
export const LEARN_AHEAD_MS = 20 * 60 * 1000;

const reverse = alias(userCards, "reverse");
// The other direction of a card's word, when looking for one that was first shown today.
const introduced = alias(userCards, "introduced");

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

export type StudyCounts = { learning: number; review: number; new: number };

export interface StudyBatch {
  now: Date;
  counts: StudyCounts;
  cards: StudyCard[];
}

// What to study: a scope (a language pair, or one direction of it; with neither, every deck) and
// how many cards at most.
type Options = Scope & { limit: number; early?: boolean };

// The conditions that define what is studyable now, and how many of each kind.
//
// Each language pair is a deck of its own: its session gap and its daily new-card limit are
// worked out from that pair's reviews only, so studying one pair never holds back or uses up
// another. (Asking about no pair at all covers every deck as one.)
//
// Sessions are separated by SESSION_GAP_MS: after the last answer, cards still in
// (re)learning are held back until the gap has passed, so they cannot trickle back
// into the session that just ended. (The clock is the deck's latest review, which is
// when their session ended.) Reviews that are due and new cards are not held back.
// With `early`, in the last EARLY_START_WINDOW_MS of the wait, the next session
// starts now and offers what would be ready when the wait ends.
async function prepare(db: Db, userId: string, opts: Omit<Options, "limit">, now: Date) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");

  // The reviews of this deck: those of cards in the pair (all of them when there is no pair).
  const pair = pairOf(opts);
  const deckReviews = and(eq(reviewLogs.userId, userId), pair ? inPair(userCards, pair) : undefined);

  const [last] = await db
    .select({ at: max(reviewLogs.reviewedAt) })
    .from(reviewLogs)
    .innerJoin(userCards, eq(userCards.id, reviewLogs.userCardId))
    .where(deckReviews);
  const gateAt = last?.at ? new Date(last.at.getTime() + SESSION_GAP_MS) : null;
  const gated = gateAt !== null && now < gateAt;
  const early = gated && !!opts.early && gateAt.getTime() - now.getTime() <= EARLY_START_WINDOW_MS;
  // What counts as due is judged at the end of the wait when starting early.
  const asOf = early ? gateAt! : now;

  const mine = and(eq(userCards.userId, userId), inScope(userCards, opts));
  const learningDue = and(
    mine,
    inArray(userCards.state, ["learning", "relearning"]),
    lte(userCards.dueAt, new Date(asOf.getTime() + LEARN_AHEAD_MS)),
    gated && !early ? sql`false` : undefined,
  );
  const reviewDue = and(mine, eq(userCards.state, "review"), lte(userCards.dueAt, asOf));
  const dayStart = studyDayStart(now, user.timezone);
  const isNewAtAll = and(mine, eq(userCards.state, "new"));
  // A new card whose reverse (same word, other direction) was first shown today waits until the
  // next study day: seeing a word both ways in one day is not much of a test of either, and the
  // second look would just be the first one again. Only a first look counts, whatever the answer.
  const reverseIntroducedToday = exists(
    db
      .select({ one: sql`1` })
      .from(reviewLogs)
      .innerJoin(introduced, eq(introduced.id, reviewLogs.userCardId))
      .where(
        and(
          eq(reviewLogs.userId, userId),
          eq(reviewLogs.stateBefore, "new"),
          gte(reviewLogs.reviewedAt, dayStart),
          eq(introduced.conceptId, userCards.conceptId),
          eq(introduced.fromLanguage, userCards.toLanguage),
          eq(introduced.toLanguage, userCards.fromLanguage),
        ),
      ),
  );
  const isNew = and(isNewAtAll, not(reverseIntroducedToday));

  // The daily new-card limit is per language pair, not per direction: it counts the cards the
  // user saw for the first time in the pair since the study day began and had to learn. A new card marked
  // Good or Easy on that first look is a word they already know, so it is free: only Again
  // and Hard count. (It is the first answer that decides; later ones are not first looks.)
  const [{ n: introducedToday } = { n: 0 }] = await db
    .select({ n: count() })
    .from(reviewLogs)
    .innerJoin(userCards, eq(userCards.id, reviewLogs.userCardId))
    .where(
      and(
        deckReviews,
        eq(reviewLogs.stateBefore, "new"),
        inArray(reviewLogs.rating, ["again", "hard"]),
        gte(reviewLogs.reviewedAt, dayStart),
      ),
    );
  const newAllowed = Math.max(0, user.dailyNewCardLimit - introducedToday);

  const countWhere = async (where: ReturnType<typeof and>) => {
    const [row] = await db.select({ n: count() }).from(userCards).where(where);
    return row?.n ?? 0;
  };
  const counts: StudyCounts = {
    learning: await countWhere(learningDue),
    review: await countWhere(reviewDue),
    new: Math.min(newAllowed, await countWhere(isNew)),
  };
  return {
    learningDue,
    reviewDue,
    isNew,
    // New cards as they will be tomorrow, when none is held back for its reverse any more.
    isNewTomorrow: isNewAtAll,
    counts,
    gateAt: gated ? gateAt : null,
    mine,
    countWhere,
    user,
  };
}

/**
 * How many cards of each kind a session would offer, without loading any cards, and,
 * while the next session is being held back, when it opens and how many cards will be
 * ready then.
 */
export async function getStudyCounts(
  db: Db,
  userId: string,
  opts: Omit<Options, "limit">,
  now: Date,
): Promise<{
  now: Date;
  counts: StudyCounts;
  nextSession: { at: Date; count: number } | null;
  tomorrow: number;
}> {
  const { counts, gateAt, mine, countWhere, isNewTomorrow, user } = await prepare(db, userId, opts, now);

  let nextSession: { at: Date; count: number } | null = null;
  if (gateAt) {
    // Everything that will be due by the time the wait is over.
    const ready =
      (await countWhere(
        and(
          mine,
          inArray(userCards.state, ["learning", "relearning"]),
          lte(userCards.dueAt, new Date(gateAt.getTime() + LEARN_AHEAD_MS)),
        ),
      )) +
      (await countWhere(and(mine, eq(userCards.state, "review"), lte(userCards.dueAt, gateAt))));
    if (ready > 0) nextSession = { at: gateAt, count: ready };
  }

  // What will be waiting by the end of tomorrow's study day: everything due by then, plus
  // the new cards tomorrow's daily limit (which starts afresh) will let in.
  const end = endOfTomorrow(now, user.timezone);
  const dueByTomorrow =
    (await countWhere(
      and(
        mine,
        inArray(userCards.state, ["learning", "relearning"]),
        lte(userCards.dueAt, end),
      ),
    )) + (await countWhere(and(mine, eq(userCards.state, "review"), lte(userCards.dueAt, end))));
  const newTomorrow = Math.min(user.dailyNewCardLimit, await countWhere(isNewTomorrow));

  return { now, counts, nextSession, tomorrow: dueByTomorrow + newTomorrow };
}

/**
 * The next cards to study, in order. New cards are mixed in near the front
 * (see interleaveNew); everything else that is due, learning cards and reviews
 * alike, goes by how likely the user is to have forgotten it, most likely
 * first, so what is left at the end of a session is what they probably know.
 */
export async function getStudyBatch(
  db: Db,
  userId: string,
  opts: Options,
  now: Date,
  scheduler: Scheduler,
): Promise<StudyBatch> {
  const { learningDue, reviewDue, isNew, counts } = await prepare(db, userId, opts, now);

  const due = await db.select().from(userCards).where(or(learningDue, reviewDue));
  const ranked = due
    .map((card) => ({ card, recall: scheduler.retrievability(card, now) }))
    .sort(
      (a, b) =>
        a.recall - b.recall ||
        a.card.dueAt.getTime() - b.card.dueAt.getTime() ||
        a.card.id.localeCompare(b.card.id),
    )
    .map((x) => x.card);

  // A new card whose reverse (same word, other direction) is in review, or relearning
  // after a lapse, comes before other new cards: you have known the word one way, so
  // learn it the other way now. A reverse still in its first learning steps doesn't count.
  const reverseKnown = exists(
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
  const newCards =
    counts.new > 0
      ? await db
          .select()
          .from(userCards)
          .where(isNew)
          .orderBy(
            sql`(case when ${reverseKnown} then 0 else 1 end)`,
            asc(userCards.addedAt),
            asc(userCards.sortKey),
            asc(userCards.id),
          )
          .limit(counts.new)
      : [];

  const rows = interleaveNew(newCards, ranked).slice(0, opts.limit);

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
