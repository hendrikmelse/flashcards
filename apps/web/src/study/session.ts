import type { Rating, ReviewResponse, StudyCardView } from "@flashcards/shared";

// The client-side model of one study session. The server decides what each
// answer means (POST /reviews); this decides what to show next, including
// bringing "learning" cards back a few minutes after they were answered.

export interface WaitingCard {
  card: StudyCardView;
  /** Client-clock time (ms) when the card becomes ready to show again. */
  readyAt: number;
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
  waiting: WaitingCard[];
  current: StudyCardView | null;
  revealed: boolean;
  /** Ids answered at least once this session; never re-added from server data. */
  handled: string[];
  stats: SessionStats;
  /** The server had nothing new to offer the last time we asked. */
  exhausted: boolean;
  fetchError: boolean;
}

export const initialState: SessionState = {
  queue: [],
  waiting: [],
  current: null,
  revealed: false,
  handled: [],
  stats: { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 },
  exhausted: false,
  fetchError: false,
};

export type Action =
  | { type: "fetched"; cards: StudyCardView[] }
  | { type: "fetchFailed" }
  | { type: "retryFetch" }
  | { type: "pick"; now: number }
  | { type: "reveal" }
  | { type: "answered"; rating: Rating; result: ReviewResponse; now: number };

export function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case "fetched": {
      // Dedupe when the response is applied (not when it was requested), so a
      // slow response can't resurrect cards answered in the meantime.
      const known = new Set<string>([
        ...state.handled,
        ...state.queue.map((c) => c.id),
        ...state.waiting.map((w) => w.card.id),
        ...(state.current ? [state.current.id] : []),
      ]);
      const fresh = action.cards.filter((c) => !known.has(c.id));
      return {
        ...state,
        fetchError: false,
        queue: [...state.queue, ...fresh],
        exhausted: fresh.length === 0 && state.queue.length === 0,
      };
    }

    case "fetchFailed":
      return { ...state, fetchError: true };

    case "retryFetch":
      return { ...state, fetchError: false };

    case "pick": {
      if (state.current) return state;

      // A card that has finished waiting comes first, earliest first; otherwise
      // the next fresh card.
      const ready = state.waiting
        .filter((w) => w.readyAt <= action.now)
        .sort((a, b) => a.readyAt - b.readyAt)[0];
      if (ready) {
        return {
          ...state,
          current: ready.card,
          revealed: false,
          waiting: state.waiting.filter((w) => w !== ready),
        };
      }
      const [next, ...rest] = state.queue;
      if (next) return { ...state, current: next, revealed: false, queue: rest };
      return state; // nothing ready: caller waits or fetches
    }

    case "reveal":
      return state.current && !state.revealed ? { ...state, revealed: true } : state;

    case "answered": {
      const card = state.current;
      if (!card) return state;
      const { rating, result, now } = action;

      // Cards still being learned return within this session, after the delay
      // the server chose (measured on the server clock, so skew can't matter).
      const comesBack = result.state === "learning" || result.state === "relearning";
      const delay = Math.max(0, Date.parse(result.dueAt) - Date.parse(result.reviewedAt));

      return {
        ...state,
        current: null,
        revealed: false,
        waiting: comesBack
          ? [...state.waiting, { card: { ...card, state: result.state }, readyAt: now + delay }]
          : state.waiting,
        handled: state.handled.includes(card.id) ? state.handled : [...state.handled, card.id],
        stats: {
          ...state.stats,
          reviewed: state.stats.reviewed + 1,
          [rating]: state.stats[rating] + 1,
        },
      };
    }
  }
}

export type Phase = "loading" | "card" | "waiting" | "done" | "error";

export function phaseOf(state: SessionState): Phase {
  if (state.current) return "card";
  if (state.waiting.length > 0) return "waiting";
  if (state.fetchError) return "error";
  if (state.exhausted && state.queue.length === 0) return "done";
  return "loading";
}

/** Earliest time a waiting card becomes ready, or null if none are waiting. */
export function nextReadyAt(state: SessionState): number | null {
  return state.waiting.length === 0 ? null : Math.min(...state.waiting.map((w) => w.readyAt));
}

/** Cards still to be shown in the batch loaded so far, including the current one. */
export function remaining(state: SessionState): number {
  return state.queue.length + state.waiting.length + (state.current ? 1 : 0);
}
