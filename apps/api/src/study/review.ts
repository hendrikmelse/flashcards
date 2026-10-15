import { and, desc, eq, isNull } from "drizzle-orm";
import { UNDO_WINDOW_MS, type SubmitReviewInput } from "@flashcards/shared";
import { reviewLogs, userCards, users, type CardBefore } from "../db/schema.js";
import type { Db } from "../db/types.js";
import type { CardStateName, Scheduler } from "../srs/engine.js";
import { studyDayStart } from "./day.js";

interface ReviewResult {
  userCardId: string;
  state: CardStateName;
  dueAt: Date;
  intervalDays: number;
  /** Server time of the answer. dueAt - reviewedAt is how long until the card returns, free of client clock skew. */
  reviewedAt: Date;
  /** True when this clientReviewId was already applied and nothing changed. */
  replayed: boolean;
}

export type ReviewOutcome =
  | { kind: "ok"; result: ReviewResult }
  | { kind: "not_found" }
  | { kind: "conflict" };

// Applies one answer atomically: locks the card, runs the scheduler, updates
// the card and appends to the review log. The lock is taken before the
// idempotency check so two concurrent retries can't both apply.
export async function submitReview(
  db: Db,
  scheduler: Scheduler,
  userId: string,
  input: SubmitReviewInput,
  now: Date,
): Promise<ReviewOutcome> {
  return db.transaction(async (tx): Promise<ReviewOutcome> => {
    const [card] = await tx
      .select()
      .from(userCards)
      .where(and(eq(userCards.id, input.userCardId), eq(userCards.userId, userId)))
      .for("update");
    if (!card) return { kind: "not_found" };

    const [prior] = await tx
      .select()
      .from(reviewLogs)
      .where(
        and(
          eq(reviewLogs.userId, userId),
          eq(reviewLogs.clientReviewId, input.clientReviewId),
        ),
      );
    if (prior) {
      if (prior.userCardId !== card.id) return { kind: "conflict" };
      return {
        kind: "ok",
        result: {
          userCardId: card.id,
          state: prior.stateAfter,
          dueAt: prior.dueAfter,
          intervalDays: prior.intervalAfterDays,
          reviewedAt: prior.reviewedAt,
          replayed: true,
        },
      };
    }

    // Cards in review come due at the start of a study day, in the user's time zone.
    const [owner] = await tx.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
    const timeZone = owner?.timezone ?? "UTC";
    const next = scheduler.review(card, input.rating, now, {
      dayStart: (date) => studyDayStart(date, timeZone),
    });

    await tx
      .update(userCards)
      .set({
        state: next.state,
        dueAt: next.dueAt,
        intervalDays: next.intervalDays,
        stability: next.stability,
        difficulty: next.difficulty,
        learningStep: next.learningStep,
        repetitions: next.repetitions,
        lapses: next.lapses,
        lastReviewedAt: now,
      })
      .where(eq(userCards.id, card.id));

    await tx.insert(reviewLogs).values({
      cardBefore: snapshotOf(card),
      userCardId: card.id,
      userId,
      clientReviewId: input.clientReviewId,
      rating: input.rating,
      reviewedAt: now,
      timeTakenMs: input.timeTakenMs,
      stateBefore: card.state,
      stateAfter: next.state,
      intervalBeforeDays: card.intervalDays,
      intervalAfterDays: next.intervalDays,
      dueAfter: next.dueAt,
    });

    return {
      kind: "ok",
      result: {
        userCardId: card.id,
        state: next.state,
        dueAt: next.dueAt,
        intervalDays: next.intervalDays,
        reviewedAt: now,
        replayed: false,
      },
    };
  });
}

// The card's scheduling fields, kept with the answer so that it can be undone exactly.
function snapshotOf(card: typeof userCards.$inferSelect): CardBefore {
  return {
    state: card.state,
    dueAt: card.dueAt.toISOString(),
    intervalDays: card.intervalDays,
    stability: card.stability,
    difficulty: card.difficulty,
    learningStep: card.learningStep,
    repetitions: card.repetitions,
    lapses: card.lapses,
    lastReviewedAt: card.lastReviewedAt?.toISOString() ?? null,
  };
}

export type UndoOutcome =
  | { kind: "ok"; result: ReviewResult & { undone: true } }
  | { kind: "not_found" }
  /** Too long ago. */
  | { kind: "expired" }
  /** The card has been answered again since, or changed some other way. */
  | { kind: "superseded" }
  /** Answered before undo existed, so there is nothing to restore it from. */
  | { kind: "unavailable" };

// Takes an answer back: the card goes back to how it was before it, and the log row is marked undone
// (it stays, since the log is append-only, but no longer counts as a review). Only the latest answer
// of a card can be undone, and only for a short while. Undoing twice is the same as undoing once.
export async function undoReview(db: Db, userId: string, clientReviewId: string, now: Date): Promise<UndoOutcome> {
  return db.transaction(async (tx): Promise<UndoOutcome> => {
    const [log] = await tx
      .select()
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.clientReviewId, clientReviewId)));
    if (!log) return { kind: "not_found" };

    // The card is locked first, like when answering, so an undo and a new answer cannot both apply.
    const [card] = await tx
      .select()
      .from(userCards)
      .where(and(eq(userCards.id, log.userCardId), eq(userCards.userId, userId)))
      .for("update");
    if (!card) return { kind: "not_found" };

    const resultOf = (c: typeof userCards.$inferSelect, replayed: boolean): ReviewResult & { undone: true } => ({
      userCardId: c.id,
      state: c.state,
      dueAt: c.dueAt,
      intervalDays: c.intervalDays,
      reviewedAt: log.reviewedAt,
      replayed,
      undone: true,
    });

    // Already undone, possibly by a retry of this very request that finished while we waited for the lock.
    if (log.undoneAt) return { kind: "ok", result: resultOf(card, true) };
    const [fresh] = await tx.select({ undoneAt: reviewLogs.undoneAt }).from(reviewLogs).where(eq(reviewLogs.id, log.id));
    if (fresh?.undoneAt) return { kind: "ok", result: resultOf(card, true) };

    if (!log.cardBefore) return { kind: "unavailable" };
    if (now.getTime() - log.reviewedAt.getTime() > UNDO_WINDOW_MS) return { kind: "expired" };

    const [latest] = await tx
      .select({ id: reviewLogs.id })
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userCardId, card.id), isNull(reviewLogs.undoneAt)))
      .orderBy(desc(reviewLogs.reviewedAt), desc(reviewLogs.id))
      .limit(1);
    if (latest?.id !== log.id) return { kind: "superseded" };

    const before = log.cardBefore;
    const [back] = await tx
      .update(userCards)
      .set({
        state: before.state,
        dueAt: new Date(before.dueAt),
        intervalDays: before.intervalDays,
        stability: before.stability,
        difficulty: before.difficulty,
        learningStep: before.learningStep,
        repetitions: before.repetitions,
        lapses: before.lapses,
        lastReviewedAt: before.lastReviewedAt ? new Date(before.lastReviewedAt) : null,
      })
      .where(eq(userCards.id, card.id))
      .returning();
    await tx.update(reviewLogs).set({ undoneAt: now }).where(eq(reviewLogs.id, log.id));
    return { kind: "ok", result: resultOf(back!, false) };
  });
}
