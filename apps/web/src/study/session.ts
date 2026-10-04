import type { Rating, ReviewResponse, StudyCardView } from "@flashcards/shared";

// The client-side model of one study session. The server decides what each
// answer means (POST /reviews); this decides what to show next. A card answered
// "Again" goes back into the queue a few cards later. A card answered Hard or Good
// that is still being learned leaves the session: the server holds it back until
// the gap between sessions has passed. The session ends when the queue is empty.

/** With fewer cards than this left in the queue, an "Again" card goes to the very end. */
export const MIN_CARDS_BACK = 5;
/** How far an "Again" card's position can wander from halfway, as a share of the queue. */
export const AGAIN_FUZZ = 0.2;

/**
 * How many cards to show before an "Again" card returns, given how many are left in
 * the queue: halfway, but at least MIN_CARDS_BACK, with some jitter so a run of
 * missed cards doesn't come back in the order it left. With fewer than
 * MIN_CARDS_BACK left it returns after all of them. `random` is in [0, 1).
 */
export function againPosition(queueLength: number, random: number): number {
  if (queueLength < MIN_CARDS_BACK) return queueLength;
  const base = Math.max(MIN_CARDS_BACK, Math.floor(queueLength / 2));
  const spread = Math.max(1, Math.round(queueLength * AGAIN_FUZZ));
  const jitter = Math.round((random * 2 - 1) * spread);
  return Math.min(queueLength, Math.max(MIN_CARDS_BACK, base + jitter));
}

export interface SessionStats {
  reviewed: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export interface SessionState {
  queue: StudyCardView[];
  current: StudyCardView | null;
  revealed: boolean;
  /** Ids answered at least once this session; never re-added from server data. */
  handled: string[];
  /** Ids that left the session still being learned; they come back in a later session. */
  pending: string[];
  stats: SessionStats;
  /** The server had nothing new to offer the last time we asked. */
  exhausted: boolean;
  fetchError: boolean;
  /** The card just answered "Again", so we can tell when it is about to come straight back. */
  lastAgainId: string | null;
  /** The current card is the one just missed; show a pause before it instead of the card. */
  repeatNotice: boolean;
  /** The user ended the session early; what is left of the queue is not studied. */
  ended: boolean;
  /** New cards beyond the daily limit that the last batch left out (see StudyResponse.moreNew). */
  moreNew: number;
  /**
   * How many of those the answers so far have made room for: a new card answered Good or Easy on its
   * first look does not use the daily limit up, so another new card will take its place. They are
   * fetched when the queue runs dry, and are counted among the cards left in the meantime.
   */
  unlocked: number;
}

export const initialState: SessionState = {
  queue: [],
  current: null,
  revealed: false,
  handled: [],
  pending: [],
  stats: { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 },
  exhausted: false,
  fetchError: false,
  lastAgainId: null,
  repeatNotice: false,
  ended: false,
  moreNew: 0,
  unlocked: 0,
};

export type Action =
  | { type: "fetched"; cards: StudyCardView[]; moreNew?: number }
  | { type: "fetchFailed" }
  | { type: "retryFetch" }
  | { type: "pick" }
  | { type: "reveal" }
  | { type: "acknowledgeRepeat" }
  | { type: "end" }
  /** `random` in [0, 1) is the jitter for where an "Again" card returns. */
  | { type: "answered"; rating: Rating; result: ReviewResponse; random: number };

export function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case "fetched": {
      // Dedupe when the response is applied (not when it was requested), so a
      // slow response can't resurrect cards answered in the meantime.
      const known = new Set<string>([
        ...state.handled,
        ...state.queue.map((c) => c.id),
        ...(state.current ? [state.current.id] : []),
      ]);
      const fresh = action.cards.filter((c) => !known.has(c.id));
      return {
        ...state,
        fetchError: false,
        queue: [...state.queue, ...fresh],
        exhausted: fresh.length === 0 && state.queue.length === 0,
        // What was made room for has arrived with the batch (or is not coming).
        moreNew: action.moreNew ?? 0,
        unlocked: 0,
      };
    }

    case "fetchFailed":
      return { ...state, fetchError: true };

    case "retryFetch":
      return { ...state, fetchError: false };

    case "pick": {
      if (state.current) return state;
      const [next, ...rest] = state.queue;
      if (!next) return state; // nothing to show: the caller fetches more, or the session is over
      return {
        ...state,
        current: next,
        revealed: false,
        repeatNotice: next.id === state.lastAgainId,
        queue: rest,
      };
    }

    case "reveal":
      return state.current && !state.revealed && !state.repeatNotice
        ? { ...state, revealed: true }
        : state;

    case "acknowledgeRepeat":
      return state.repeatNotice ? { ...state, repeatNotice: false } : state;

    case "end":
      return state.ended ? state : { ...state, ended: true };

    case "answered": {
      const card = state.current;
      if (!card) return state;
      const { rating, result, random } = action;

      const stillLearning = result.state === "learning" || result.state === "relearning";
      const missed = rating === "again" && stillLearning;
      const returning = { ...card, state: result.state };
      const at = againPosition(state.queue.length, random);
      // A new card that is already known does not use up the daily limit, so another one follows it.
      const makesRoom = card.state === "new" && (rating === "good" || rating === "easy");

      return {
        ...state,
        current: null,
        revealed: false,
        repeatNotice: false,
        lastAgainId: missed ? card.id : null,
        queue: missed ? [...state.queue.slice(0, at), returning, ...state.queue.slice(at)] : state.queue,
        pending:
          stillLearning && !missed && !state.pending.includes(card.id)
            ? [...state.pending, card.id]
            : state.pending,
        handled: state.handled.includes(card.id) ? state.handled : [...state.handled, card.id],
        unlocked: makesRoom ? Math.min(state.moreNew, state.unlocked + 1) : state.unlocked,
        stats: {
          ...state.stats,
          reviewed: state.stats.reviewed + 1,
          [rating]: state.stats[rating] + 1,
        },
      };
    }
  }
}

export type Phase = "loading" | "card" | "done" | "error";

export function phaseOf(state: SessionState): Phase {
  if (state.ended) return "done"; // ended early: show how it went, whatever is left
  if (state.current) return "card";
  if (state.fetchError) return "error";
  if (state.exhausted && state.queue.length === 0) return "done";
  return "loading";
}

/**
 * Cards still to be shown today, including the current one: those in the batch loaded so far, and the
 * new cards that known words have made room for, which are fetched when the queue runs dry. Without
 * the second part the number would count down on words that do not use up the daily limit, only to
 * jump back up when the next batch arrived.
 */
export function remaining(state: SessionState): number {
  return state.queue.length + (state.current ? 1 : 0) + state.unlocked;
}

/**
 * Cards from this session that will come back for another look in a later one: those answered
 * Hard or Good while still learning, plus any missed card (answered Again) that was still waiting
 * its turn when the session ended.
 */
export function reReviewCount(state: SessionState): number {
  const answered = new Set(state.handled);
  const waiting = [...state.queue, ...(state.current ? [state.current] : [])].filter((c) =>
    answered.has(c.id),
  );
  return state.pending.length + waiting.length;
}
