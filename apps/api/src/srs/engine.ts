import { createEmptyCard, fsrs, Rating as FsrsRating, State, type Card } from "ts-fsrs";
import type { Rating } from "@flashcards/shared";

export type CardStateName = "new" | "learning" | "review" | "relearning";

// The scheduling state of one user card. Mirrors the SRS columns of `user_cards`.
export interface SrsState {
  state: CardStateName;
  dueAt: Date;
  intervalDays: number;
  stability: number | null;
  difficulty: number | null;
  learningStep: number;
  repetitions: number;
  lapses: number;
  lastReviewedAt: Date | null;
}

// Pure: same input, same output. The algorithm lives behind this interface so
// it can be swapped (e.g. SM-2) without touching the endpoints.
interface ReviewOptions {
  /**
   * The start of the study day containing a moment. When given, a card in review is
   * scheduled in whole study days: it comes due at the start of the day it falls on
   * (so an afternoon answer that would be due "in 24 hours" is due first thing the next
   * morning), and the algorithm sees the gap since the last review as whole days too,
   * so reviewing early in the day is not mistaken for reviewing early.
   */
  dayStart?: (date: Date) => Date;
}

export interface Scheduler {
  review(card: SrsState, rating: Rating, now: Date, options?: ReviewOptions): SrsState;
  /**
   * The chance (0 to 1) that the card is recalled when it is next shown, for
   * ordering a study queue: lowest first means most likely forgotten. Measured at
   * the later of `now` and the card's due time, in fractional days, so cards with
   * minutes-long steps rank sensibly too. Zero when there is no memory estimate.
   */
  retrievability(card: SrsState, now: Date): number;
}

const STATE_TO_FSRS: Record<CardStateName, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};
const STATE_FROM_FSRS: Record<State, CardStateName> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};
const RATING_TO_FSRS = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
} as const;

export function newCardState(now: Date): SrsState {
  return fromFsrs(createEmptyCard(now));
}

function toFsrs(s: SrsState): Card {
  return {
    due: s.dueAt,
    stability: s.stability ?? 0,
    difficulty: s.difficulty ?? 0,
    elapsed_days: 0, // deprecated in ts-fsrs; derived from last_review
    scheduled_days: s.intervalDays,
    learning_steps: s.learningStep,
    reps: s.repetitions,
    lapses: s.lapses,
    state: STATE_TO_FSRS[s.state],
    last_review: s.lastReviewedAt ?? undefined,
  };
}

function fromFsrs(c: Card): SrsState {
  const isNew = c.state === State.New;
  return {
    state: STATE_FROM_FSRS[c.state],
    dueAt: c.due,
    intervalDays: c.scheduled_days,
    stability: isNew ? null : c.stability,
    difficulty: isNew ? null : c.difficulty,
    learningStep: c.learning_steps,
    repetitions: c.reps,
    lapses: c.lapses,
    lastReviewedAt: c.last_review ?? null,
  };
}

export interface FsrsOptions {
  /** Target probability of recalling a card when it comes due. */
  desiredRetention?: number;
  /** Randomly jitter long intervals so cards learned together don't clump. */
  fuzz?: boolean;
}

export function createFsrsScheduler({
  desiredRetention = 0.9,
  fuzz = true,
}: FsrsOptions = {}): Scheduler {
  const f = fsrs({
    request_retention: desiredRetention,
    enable_fuzz: fuzz,
    enable_short_term: true,
    learning_steps: ["1m", "10m"],
    // A forgotten card starts over from the first step, like a new card.
    relearning_steps: ["1m", "10m"],
    maximum_interval: 36500,
  });
  const run = (card: SrsState, rating: Rating, now: Date) =>
    fromFsrs(f.next(toFsrs(card), now, RATING_TO_FSRS[rating]).card);

  // Margin for landing safely inside a study day when a daylight-saving change has moved
  // "start of day plus N days" by an hour either way.
  const SIX_HOURS = 6 * 3_600_000;

  return {
    review(card, rating, now, options) {
      const dayStart = options?.dayStart;
      if (!dayStart) return run(card, rating, now);

      if (card.state === "review" && card.lastReviewedAt) {
        // Work in whole study days: both ends of the gap are moved to their day's start.
        const today = dayStart(now);
        const next = run({ ...card, lastReviewedAt: dayStart(card.lastReviewedAt) }, rating, today);
        if (next.state === "review") {
          return { ...next, dueAt: dayStart(new Date(next.dueAt.getTime() + SIX_HOURS)), lastReviewedAt: now };
        }
        // Forgotten: back to a short step, counted from the actual time, not the day's start.
        const wait = next.dueAt.getTime() - today.getTime();
        return { ...next, dueAt: new Date(now.getTime() + wait), lastReviewedAt: now };
      }

      // Cards still being learned use real time; one that graduates is due at the start of a day.
      const next = run(card, rating, now);
      return next.state === "review" ? { ...next, dueAt: dayStart(next.dueAt) } : next;
    },
    retrievability(card, now) {
      if (card.stability === null || card.lastReviewedAt === null) return 0;
      const at = Math.max(now.getTime(), card.dueAt.getTime());
      const days = Math.max(0, (at - card.lastReviewedAt.getTime()) / 86_400_000);
      return f.forgetting_curve(days, card.stability);
    },
  };
}
