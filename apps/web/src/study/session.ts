import type { Rating, ReviewResponse, StudyCardView } from "@flashcards/shared";

// The client-side model of one study session. The server decides what each
// answer means (POST /reviews); this decides what to show next. A card answered
// "Again" goes back into the queue a few cards later. A card answered Hard or Good
// that is still being learned leaves the session, and is offered again, by the server, once it is
// due. The session ends when the queue is empty.
//
// A session's cards are fixed when it begins: every request after the first asks for cards due as of
// the first one's time (`asOf`), so cards that fall due while it runs wait for the next session. Each
// batch also says how many cards the server holds in all (`total`), which the number of cards left is
// built on, so it does not depend on how many have been loaded and only goes down.

/** With fewer cards than this left in the queue, an "Again" card goes to the very end. */
const MIN_CARDS_BACK = 5;
/** How far an "Again" card's position can wander from halfway, as a share of the queue. */
const AGAIN_FUZZ = 0.2;

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

/**
 * With the server holding more cards than were loaded and fewer than this left in the queue, an
 * "Again" card waits for the next batch before it is slotted in, so it lands among enough other
 * cards instead of just behind the few that happen to be loaded.
 */
export const REFILL_BELOW = 50;

/** Puts an "Again" card back into a queue, a few cards later. */
function insertAgain(queue: StudyCardView[], card: StudyCardView, random: number): StudyCardView[] {
  const at = againPosition(queue.length, random);
  return [...queue.slice(0, at), card, ...queue.slice(at)];
}

export interface SessionStats {
  reviewed: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

/**
 * The answer just given, kept so that it can be taken back: only the latest one. What the answer
 * changed that is simply put back is in `before`; the rest (the queue, the missed cards waiting for a
 * batch) is worked out again when it is undone.
 */
export interface LastAnswer {
  /** The card as it was shown, before the answer. */
  card: StudyCardView;
  /** The id the answer was sent with, which is how the server finds it to undo. */
  clientReviewId: string;
  rating: Rating;
  /** The card had been answered before in this session (a missed card that came back). */
  wasHandled: boolean;
  /** The answer made room for another new card (see `unlocked`). */
  madeRoom: boolean;
  before: Pick<SessionState, "stats" | "exhausted" | "lastAgainId">;
}

export interface SessionState {
  queue: StudyCardView[];
  current: StudyCardView | null;
  revealed: boolean;
  /** Ids answered at least once this session; never re-added from server data. */
  handled: string[];
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
  /** The last batch was full, so the server probably has more cards than are loaded. */
  more: boolean;
  /** Cards answered "Again" that are waiting for the next batch to arrive before they go back in. */
  deferred: { card: StudyCardView; random: number }[];
  /** When the session began, as the server told us: later requests ask for cards due by then. */
  asOf: string | null;
  /**
   * Cards the server still has for this session beyond the ones held here (not yet loaded), as of
   * the last batch. They arrive in later batches.
   */
  ahead: number;
  /** The latest answer, while it can still be undone. */
  lastAnswer: LastAnswer | null;
}

export const initialState: SessionState = {
  queue: [],
  current: null,
  revealed: false,
  handled: [],
  stats: { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 },
  exhausted: false,
  fetchError: false,
  lastAgainId: null,
  repeatNotice: false,
  ended: false,
  moreNew: 0,
  unlocked: 0,
  more: false,
  deferred: [],
  asOf: null,
  ahead: 0,
  lastAnswer: null,
};

export type Action =
  | {
      type: "fetched";
      cards: StudyCardView[];
      moreNew?: number;
      more?: boolean;
      /** The server's time for this batch; the first one's becomes the session's `asOf`. */
      now?: string;
      /** Every card the server has for this session that has not been answered (see StudyResponse.total). */
      total?: number;
      /** How many cards had been answered when the request was sent; answers made while it was away are allowed for. */
      answeredAtRequest?: number;
    }
  /** Begin a new session, with whatever has come due since the last one. */
  | { type: "restart" }
  /** The server took the latest answer back: show that card again, as it was. */
  | { type: "undone" }
  /** The latest answer can no longer be undone (the time is up, or the server refused). */
  | { type: "undoExpired"; clientReviewId?: string }
  | { type: "fetchFailed" }
  | { type: "retryFetch" }
  | { type: "pick" }
  | { type: "reveal" }
  | { type: "acknowledgeRepeat" }
  | { type: "end" }
  /** `random` in [0, 1) is the jitter for where an "Again" card returns. */
  | { type: "answered"; rating: Rating; result: ReviewResponse; random: number; clientReviewId?: string };

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
      // Missed cards that were waiting for this batch go in now, among the cards that came with it.
      const queue = state.deferred.reduce(
        (q, d) => insertAgain(q, d.card, d.random),
        [...state.queue, ...fresh],
      );
      // The cards the server has that are not in hand. Cards answered in this session are not among
      // the server's: their next due date is after the session began. The ones that are in hand and
      // unanswered, and the ones answered while the request was on its way, are, so take them off.
      const answered = new Set(state.handled);
      const unansweredHeld = [...state.queue, ...fresh, ...(state.current ? [state.current] : [])].filter(
        (c) => !answered.has(c.id),
      ).length;
      const answeredSince = Math.max(0, state.handled.length - (action.answeredAtRequest ?? state.handled.length));
      const ahead = action.total === undefined ? 0 : Math.max(0, action.total - unansweredHeld - answeredSince);
      const startedAt = state.asOf ?? (action.now && !Number.isNaN(Date.parse(action.now)) ? action.now : null);
      return {
        ...state,
        fetchError: false,
        queue,
        deferred: [],
        asOf: startedAt,
        ahead,
        more: action.more ?? false,
        exhausted: fresh.length === 0 && queue.length === 0,
        // What was made room for has arrived with the batch (or is not coming).
        moreNew: action.moreNew ?? 0,
        unlocked: 0,
      };
    }

    case "fetchFailed":
      // The missed cards cannot wait for a batch that is not coming; put them back among what is loaded.
      return {
        ...state,
        fetchError: true,
        queue: state.deferred.reduce((q, d) => insertAgain(q, d.card, d.random), state.queue),
        deferred: [],
      };

    case "restart":
      return initialState;

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
      return state.ended ? state : { ...state, ended: true, lastAnswer: null };

    case "undoExpired":
      // A late timer for an answer that has since been replaced must not take the newer one away.
      return state.lastAnswer && (!action.clientReviewId || state.lastAnswer.clientReviewId === action.clientReviewId)
        ? { ...state, lastAnswer: null }
        : state;

    case "undone": {
      const last = state.lastAnswer;
      if (!last || state.ended) return state;
      const id = last.card.id;
      // The card may have been put back in the queue (missed) or held for the next batch: take it out,
      // and if another card is showing already, it goes back to the front of the queue.
      const rest = state.queue.filter((c) => c.id !== id);
      const queue = state.current && state.current.id !== id ? [state.current, ...rest] : rest;
      const dry = queue.length === 0 && state.deferred.length === 0;
      return {
        ...state,
        current: last.card,
        revealed: true, // so it can be rated again straight away
        repeatNotice: false,
        queue,
        deferred: state.deferred.filter((d) => d.card.id !== id),
        handled: last.wasHandled ? state.handled : state.handled.filter((h) => h !== id),
        stats: last.before.stats,
        lastAgainId: last.before.lastAgainId,
        // Room made for another new card is taken back, unless it has been delivered already (then the
        // queue is not empty and `unlocked` was reset by that batch).
        unlocked: last.madeRoom ? Math.max(0, state.unlocked - 1) : state.unlocked,
        exhausted: last.madeRoom && dry ? last.before.exhausted : state.exhausted,
        lastAnswer: null,
      };
    }

    case "answered": {
      const card = state.current;
      if (!card) return state;
      const { rating, result, random } = action;

      const stillLearning = result.state === "learning" || result.state === "relearning";
      const missed = rating === "again" && stillLearning; // it comes back later in this same session
      const returning = { ...card, state: result.state };
      // With more cards on the server than are loaded, and few loaded, fetch before slotting it in.
      const defer = missed && state.more && !state.exhausted && state.queue.length < REFILL_BELOW;
      // A new card that is already known does not use up the daily limit, so another one follows it.
      const makesRoom =
        card.state === "new" && (rating === "good" || rating === "easy") && state.unlocked < state.moreNew;

      return {
        ...state,
        lastAnswer: action.clientReviewId
          ? {
              card,
              clientReviewId: action.clientReviewId,
              rating,
              wasHandled: state.handled.includes(card.id),
              madeRoom: makesRoom,
              before: { stats: state.stats, exhausted: state.exhausted, lastAgainId: state.lastAgainId },
            }
          : null,
        // The queue ran dry while this card was on screen, so the top-up fetch came back empty and
        // marked the session exhausted; the new card this answer makes room for needs another fetch.
        exhausted: makesRoom ? false : state.exhausted,
        current: null,
        revealed: false,
        repeatNotice: false,
        lastAgainId: missed ? card.id : null,
        queue: missed && !defer ? insertAgain(state.queue, returning, random) : state.queue,
        deferred: defer ? [...state.deferred, { card: returning, random }] : state.deferred,
        handled: state.handled.includes(card.id) ? state.handled : [...state.handled, card.id],
        unlocked: makesRoom ? state.unlocked + 1 : state.unlocked,
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
 * Cards still to be shown in this session, including the current one: those loaded, the ones the
 * server is holding for a later batch, and the new cards that known words have made room for, which
 * are fetched when the queue runs dry. Counting only what is loaded would start at the size of one
 * batch and jump when the next arrived, and without the new cards the number would count down on
 * words that do not use up the daily limit, only to jump back up later.
 */
export function remaining(state: SessionState): number {
  return state.queue.length + state.deferred.length + (state.current ? 1 : 0) + state.ahead + state.unlocked;
}
