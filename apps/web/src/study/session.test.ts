import type { ReviewResponse, StudyCardView } from "@flashcards/shared";
import { describe, expect, it } from "vitest";
import {
  initialState,
  nextReadyAt,
  phaseOf,
  reducer,
  remaining,
  type Action,
  type SessionState,
} from "./session";

const card = (id: string): StudyCardView => ({
  id,
  conceptId: `c-${id}`,
  fromLanguage: "en",
  toLanguage: "nl",
  state: "new",
  dueAt: "2026-01-01T00:00:00.000Z",
  front: [],
  back: [],
  sentences: { front: [], back: [] },
});

const result = (state: ReviewResponse["state"], delayMs: number): ReviewResponse => ({
  userCardId: "x",
  state,
  intervalDays: 0,
  reviewedAt: "2026-01-01T12:00:00.000Z",
  dueAt: new Date(Date.parse("2026-01-01T12:00:00.000Z") + delayMs).toISOString(),
  replayed: false,
});

const run = (actions: Action[], from: SessionState = initialState) =>
  actions.reduce(reducer, from);

const T = 1_000_000;
const MIN = 60_000;

describe("session reducer", () => {
  it("starts in the loading phase", () => {
    expect(phaseOf(initialState)).toBe("loading");
  });

  it("takes cards from the fetched batch in order", () => {
    const s = run([{ type: "fetched", cards: [card("a"), card("b")] }, { type: "pick", now: T }]);
    expect(s.current?.id).toBe("a");
    expect(s.queue.map((c) => c.id)).toEqual(["b"]);
    expect(phaseOf(s)).toBe("card");
    expect(remaining(s)).toBe(2);
  });

  it("does not replace the current card when picking again", () => {
    const s = run([
      { type: "fetched", cards: [card("a"), card("b")] },
      { type: "pick", now: T },
      { type: "pick", now: T },
    ]);
    expect(s.current?.id).toBe("a");
  });

  it("reveals only once a card is showing", () => {
    expect(run([{ type: "reveal" }]).revealed).toBe(false);
    const s = run([{ type: "fetched", cards: [card("a")] }, { type: "pick", now: T }, { type: "reveal" }]);
    expect(s.revealed).toBe(true);
  });

  it("counts answers and finishes cards that graduate to review", () => {
    const s = run([
      { type: "fetched", cards: [card("a")] },
      { type: "pick", now: T },
      { type: "answered", rating: "easy", result: result("review", 8 * 24 * 60 * MIN), now: T },
    ]);
    expect(s.current).toBeNull();
    expect(s.waiting).toEqual([]);
    expect(s.stats).toMatchObject({ reviewed: 1, easy: 1, again: 0 });
    expect(s.handled).toEqual(["a"]);
  });

  it("brings learning cards back after the server's delay", () => {
    const s = run([
      { type: "fetched", cards: [card("a")] },
      { type: "pick", now: T },
      { type: "answered", rating: "good", result: result("learning", 10 * MIN), now: T },
    ]);
    expect(s.waiting).toHaveLength(1);
    expect(s.waiting[0]).toMatchObject({ readyAt: T + 10 * MIN });
    expect(s.waiting[0]!.card.state).toBe("learning");
    expect(nextReadyAt(s)).toBe(T + 10 * MIN);
    expect(phaseOf(s)).toBe("waiting");

    // Not ready yet: nothing is picked.
    expect(reducer(s, { type: "pick", now: T + 9 * MIN }).current).toBeNull();
    // Ready: it is shown again.
    const again = reducer(s, { type: "pick", now: T + 10 * MIN });
    expect(again.current?.id).toBe("a");
    expect(again.waiting).toEqual([]);
  });

  it("also requeues relearning cards", () => {
    const s = run([
      { type: "fetched", cards: [card("a")] },
      { type: "pick", now: T },
      { type: "answered", rating: "again", result: result("relearning", 10 * MIN), now: T },
    ]);
    expect(s.waiting).toHaveLength(1);
  });

  it("shows a card whose wait is over before fresh cards", () => {
    let s = run([
      { type: "fetched", cards: [card("a"), card("b"), card("c")] },
      { type: "pick", now: T },
      { type: "answered", rating: "again", result: result("learning", MIN), now: T },
      { type: "pick", now: T }, // b
    ]);
    expect(s.current?.id).toBe("b");
    s = run([{ type: "answered", rating: "easy", result: result("review", 1e9), now: T + 2 * MIN }], s);
    s = reducer(s, { type: "pick", now: T + 2 * MIN });
    expect(s.current?.id).toBe("a"); // finished waiting, so it beats c
  });

  it("can be forced early with an infinite clock (Continue now)", () => {
    const s = run([
      { type: "fetched", cards: [card("a")] },
      { type: "pick", now: T },
      { type: "answered", rating: "again", result: result("learning", MIN), now: T },
      { type: "pick", now: Infinity },
    ]);
    expect(s.current?.id).toBe("a");
  });

  it("never re-adds cards answered this session when the server returns them again", () => {
    let s = run([
      { type: "fetched", cards: [card("a")] },
      { type: "pick", now: T },
      { type: "answered", rating: "good", result: result("learning", 10 * MIN), now: T },
    ]);
    // The server still lists "a" (learning, due within its look-ahead window).
    s = reducer(s, { type: "fetched", cards: [card("a")] });
    expect(s.queue).toEqual([]);
    expect(s.waiting).toHaveLength(1);
    expect(s.exhausted).toBe(true);
  });

  it("is done once the server has nothing more and nothing is waiting", () => {
    const s = run([
      { type: "fetched", cards: [card("a")] },
      { type: "pick", now: T },
      { type: "answered", rating: "easy", result: result("review", 1e9), now: T },
      { type: "fetched", cards: [card("a")] },
    ]);
    expect(phaseOf(s)).toBe("done");
  });

  it("an empty first batch means there is nothing to study", () => {
    expect(phaseOf(reducer(initialState, { type: "fetched", cards: [] }))).toBe("done");
  });

  it("a duplicate late response does not wrongly mark the session exhausted", () => {
    // e.g. React StrictMode fetching twice: the second response is all duplicates
    // but the queue still has cards, so more may come later.
    let s = reducer(initialState, { type: "fetched", cards: [card("a"), card("b")] });
    s = reducer(s, { type: "fetched", cards: [card("a"), card("b")] });
    expect(s.exhausted).toBe(false);
    expect(s.queue).toHaveLength(2);
  });

  it("recovers from a failed fetch", () => {
    let s = reducer(initialState, { type: "fetchFailed" });
    expect(phaseOf(s)).toBe("error");
    s = reducer(s, { type: "retryFetch" });
    expect(phaseOf(s)).toBe("loading");
  });
});
