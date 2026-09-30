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
export interface Scheduler {
  review(card: SrsState, rating: Rating, now: Date): SrsState;
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
    relearning_steps: ["10m"],
    maximum_interval: 36500,
  });
  return {
    review(card, rating, now) {
      const { card: next } = f.next(toFsrs(card), now, RATING_TO_FSRS[rating]);
      return fromFsrs(next);
    },
  };
}
