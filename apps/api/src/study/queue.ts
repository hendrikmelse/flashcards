import { and, asc, count, eq, exists, getTableColumns, gte, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { EntryView } from "@flashcards/shared";
import { loadEntries, loadSentences, sentenceKey } from "../content/queries.js";
import { reviewLogs, userCards, users } from "../db/schema.js";
import type { Db } from "../db/types.js";
import type { Scheduler } from "../srs/engine.js";
import { endOfTomorrow, studyDayStart } from "./day.js";
import { interleaveNew, pickNew } from "./order.js";
import { inPair, inScope, pairOf } from "./scope.js";

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
  /** The user has never answered a card, in any language pair. */
  firstSession: boolean;
  /** New cards beyond the daily limit's share, which first looks rated Good or Easy make room for. */
  moreNew: number;
}

// What to study: a scope (a language pair, or one direction of it; with neither, every deck) and
// how many cards at most.
type Options = { pair?: string | undefined; limit: number };

// The conditions that define what is studyable now, and how many of each kind.
//
// Each language pair is a deck of its own: its daily new-card limit is worked out from that
// pair's reviews only, so studying one pair never uses up another. (Asking about no pair at all
// covers every deck as one.)
//
// Nothing is held back between sessions, and nothing is offered early: a card is studyable once it
// is due, and not before.
async function prepare(db: Db, userId: string, opts: Omit<Options, "limit">, now: Date) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");

  // The reviews of this deck: those of cards in the pair (all of them when there is no pair).
  const pair = pairOf(opts);
  const deckReviews = and(eq(reviewLogs.userId, userId), pair ? inPair(userCards, pair) : undefined);

  const mine = and(eq(userCards.userId, userId), inScope(userCards, opts));
  const learningDue = and(
    mine,
    inArray(userCards.state, ["learning", "relearning"]),
    lte(userCards.dueAt, now),
  );
  const reviewDue = and(mine, eq(userCards.state, "review"), lte(userCards.dueAt, now));
  const dayStart = studyDayStart(now, user.timezone);
  const isNew = and(mine, eq(userCards.state, "new"));
  // A new card whose reverse (same word, other direction) was first shown today comes after the
  // other new cards: seeing a word both ways in one day is not much of a test of either, and the
  // second look would just be the first one again. It is still offered when there is nothing else
  // new to show. Only a first look counts, whatever the answer.
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
  const newInDeck = await countWhere(isNew);
  const counts: StudyCounts = {
    learning: await countWhere(learningDue),
    review: await countWhere(reviewDue),
    new: Math.min(newAllowed, newInDeck),
  };
  return {
    learningDue,
    reviewDue,
    isNew,
    reverseIntroducedToday,
    counts,
    // There are new cards, but today's allowance of them has been used up (or is nothing).
    newLimitReached: newAllowed === 0 && newInDeck > 0,
    newInDeck,
    mine,
    countWhere,
    user,
  };
}

/** How many cards of each kind a session would offer, without loading any cards. */
export async function getStudyCounts(
  db: Db,
  userId: string,
  opts: Omit<Options, "limit">,
  now: Date,
): Promise<{
  now: Date;
  counts: StudyCounts;
  newLimitReached: boolean;
  tomorrow: number;
}> {
  const { counts, newLimitReached, mine, countWhere, isNew, user } = await prepare(db, userId, opts, now);

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
  const newTomorrow = Math.min(user.dailyNewCardLimit, await countWhere(isNew));

  return { now, counts, newLimitReached, tomorrow: dueByTomorrow + newTomorrow };
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
  const { learningDue, reviewDue, isNew, reverseIntroducedToday, counts, newInDeck } = await prepare(db, userId, opts, now);

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
  // More than are needed are loaded, so that when a word has both of its directions among the first
  // few, there are other words to choose instead (see pickNew).
  const candidates =
    counts.new > 0
      ? await db
          .select({ ...getTableColumns(userCards), held: sql<boolean>`${reverseIntroducedToday}` })
          .from(userCards)
          .where(isNew)
          .orderBy(
            // Last: cards whose reverse was first shown today. First: cards whose reverse is known.
            sql`(case when ${reverseIntroducedToday} then 2 when ${reverseKnown} then 0 else 1 end)`,
            asc(userCards.addedAt),
            asc(userCards.sortKey),
            asc(userCards.id),
          )
          .limit(counts.new * 2)
      : [];
  const newCards = pickNew(candidates, counts.new);

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

  const [answered] = await db
    .select({ one: sql`1` })
    .from(reviewLogs)
    .where(eq(reviewLogs.userId, userId))
    .limit(1);

  return { now, counts, cards, firstSession: !answered, moreNew: Math.max(0, newInDeck - counts.new) };
}
