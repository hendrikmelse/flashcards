import { and, eq } from "drizzle-orm";
import type { SubmitReviewInput } from "@flashcards/shared";
import { reviewLogs, userCards, users } from "../db/schema.js";
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
