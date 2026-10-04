import type { ReviewResponse, StudyCardView } from "@flashcards/shared";
import { describe, expect, it } from "vitest";
import {
  againPosition,
  initialState,
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

const MIN = 60_000;

const result = (state: ReviewResponse["state"], delayMs = MIN): ReviewResponse => ({
  userCardId: "x",
  state,
  intervalDays: 0,
  reviewedAt: "2026-01-01T12:00:00.000Z",
  dueAt: new Date(Date.parse("2026-01-01T12:00:00.000Z") + delayMs).toISOString(),
  replayed: false,
});

const run = (actions: Action[], from: SessionState = initialState) => actions.reduce(reducer, from);

const answer = (
  rating: "again" | "hard" | "good" | "easy",
  state: ReviewResponse["state"],
  random = 0.5,
): Action => ({ type: "answered", rating, result: result(state), random });

const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => card(`c${from + i}`));

describe("session reducer", () => {
  it("starts in the loading phase", () => {
    expect(phaseOf(initialState)).toBe("loading");
  });

  it("takes cards from the fetched batch in order", () => {
    const s = run([{ type: "fetched", cards: [card("a"), card("b")] }, { type: "pick" }]);
    expect(s.current?.id).toBe("a");
    expect(s.queue.map((c) => c.id)).toEqual(["b"]);
    expect(phaseOf(s)).toBe("card");
    expect(remaining(s)).toBe(2);
  });

  it("does not replace the current card when picking again", () => {
    const s = run([{ type: "fetched", cards: [card("a"), card("b")] }, { type: "pick" }, { type: "pick" }]);
    expect(s.current?.id).toBe("a");
  });

  it("reveals only once a card is showing", () => {
    expect(run([{ type: "reveal" }]).revealed).toBe(false);
    const s = run([{ type: "fetched", cards: [card("a")] }, { type: "pick" }, { type: "reveal" }]);
    expect(s.revealed).toBe(true);
  });

  it("counts answers and finishes cards that graduate to review", () => {
    const s = run([{ type: "fetched", cards: [card("a")] }, { type: "pick" }, answer("easy", "review")]);
    expect(s.current).toBeNull();
    expect(s.stats).toMatchObject({ reviewed: 1, easy: 1, again: 0 });
    expect(s.handled).toEqual(["a"]);
  });

  it("never re-adds cards answered this session when the server returns them again", () => {
    let s = run([{ type: "fetched", cards: [card("a")] }, { type: "pick" }, answer("good", "learning")]);
    // The server may still list "a", as a card being learned can still be due.
    s = reducer(s, { type: "fetched", cards: [card("a")] });
    expect(s.queue).toEqual([]);
    expect(s.exhausted).toBe(true);
  });

  it("is done once the server has nothing more", () => {
    const s = run([
      { type: "fetched", cards: [card("a")] },
      { type: "pick" },
      answer("easy", "review"),
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

describe("cards still being learned", () => {
  it("are not put back in the session after Hard or Good", () => {
    for (const rating of ["hard", "good"] as const) {
      const s = run([{ type: "fetched", cards: [card("a"), card("b")] }, { type: "pick" }, answer(rating, "learning")]);
      expect(s.queue.map((c) => c.id)).toEqual(["b"]);
    }
  });

  it("end the session when the queue runs out", () => {
    const s = run([
      { type: "fetched", cards: [card("a"), card("b")] },
      { type: "pick" },
      answer("good", "learning"),
      { type: "pick" },
      answer("easy", "review"),
      { type: "fetched", cards: [] },
    ]);
    expect(phaseOf(s)).toBe("done");
  });

  it("are not put back once a missed card is finally answered Good", () => {
    const s = run([
      { type: "fetched", cards: [card("a")] },
      { type: "pick" },
      answer("again", "learning"),
      { type: "pick" },
      { type: "acknowledgeRepeat" },
      answer("good", "learning"),
    ]);
    expect(s.queue).toEqual([]);
  });
});

describe("againPosition", () => {
  it("sends the card to the very end when fewer than five cards are left", () => {
    for (const n of [0, 1, 2, 3, 4]) {
      for (const r of [0, 0.5, 0.99]) expect(againPosition(n, r)).toBe(n);
    }
  });

  it("goes about halfway back, but never closer than five cards", () => {
    expect(againPosition(5, 0.5)).toBe(5);
    expect(againPosition(8, 0)).toBe(5);
    expect(againPosition(10, 0.5)).toBe(5);
    expect(againPosition(20, 0.5)).toBe(10);
    expect(againPosition(40, 0.5)).toBe(20);
    expect(againPosition(100, 0.5)).toBe(50);
  });

  it("varies with the random jitter, within about a fifth of the queue either way", () => {
    expect(againPosition(40, 0)).toBe(12); // 20 - 8
    expect(againPosition(40, 0.999)).toBe(28); // 20 + 8
    expect(againPosition(100, 0)).toBe(30);
    // Never before five, never past the end.
    expect(againPosition(12, 0)).toBe(5);
    expect(againPosition(6, 0.999)).toBe(6);
  });

  it("is monotonic in the random value", () => {
    let last = -1;
    for (let r = 0; r < 1; r += 0.05) {
      const p = againPosition(60, r);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });
});

describe("missed cards", () => {
  it("go back into the queue instead of waiting", () => {
    const s = run([{ type: "fetched", cards: [card("a"), card("b"), card("c")] }, { type: "pick" }, answer("again", "learning")]);
    // Only two cards were left, so it goes after both.
    expect(s.queue.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(s.queue[2]!.state).toBe("learning");
    expect(s.stats.again).toBe(1);
    expect(s.handled).toEqual(["a"]);
  });

  it("treat a forgotten review card (relearning) the same way", () => {
    const s = run([{ type: "fetched", cards: [card("a"), card("b")] }, { type: "pick" }, answer("again", "relearning")]);
    expect(s.queue.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("return about halfway back through the cards that are left", () => {
    const s = run([{ type: "fetched", cards: ids(21) }, { type: "pick" }, answer("again", "learning", 0.5)]);
    expect(s.queue).toHaveLength(21);
    expect(s.queue[10]!.id).toBe("c1"); // 20 left: halfway is 10
    expect(s.queue.slice(0, 10).map((c) => c.id)).toEqual(ids(10, 2).map((c) => c.id));
  });

  it("do not come back in the order they were missed", () => {
    // Miss c1, c2 and c3 in turn, with different jitter each time.
    let s = run([{ type: "fetched", cards: ids(30) }]);
    for (const random of [0.9, 0.1, 0.5]) {
      s = reducer(s, { type: "pick" });
      s = reducer(s, answer("again", "learning", random));
    }
    const order = s.queue.map((c) => c.id).filter((id) => ["c1", "c2", "c3"].includes(id));
    expect(order).not.toEqual(["c1", "c2", "c3"]);
    expect(new Set(order).size).toBe(3);
  });

  it("do not trigger a pause when other cards come first", () => {
    const s = run([{ type: "fetched", cards: ids(3) }, { type: "pick" }, answer("again", "learning"), { type: "pick" }]);
    expect(s.current?.id).toBe("c2");
    expect(s.repeatNotice).toBe(false);
  });
});

describe("the pause before the same card comes straight back", () => {
  const missOnlyCard = () =>
    run([{ type: "fetched", cards: [card("a")] }, { type: "pick" }, answer("again", "learning"), { type: "pick" }]);

  it("holds the card behind a notice when it is the only one left", () => {
    const s = missOnlyCard();
    expect(s.current?.id).toBe("a");
    expect(s.repeatNotice).toBe(true);
    expect(phaseOf(s)).toBe("card");
  });

  it("cannot be revealed until the notice is acknowledged", () => {
    let s = reducer(missOnlyCard(), { type: "reveal" });
    expect(s.revealed).toBe(false);
    s = reducer(s, { type: "acknowledgeRepeat" });
    expect(s.repeatNotice).toBe(false);
    s = reducer(s, { type: "reveal" });
    expect(s.revealed).toBe(true);
  });

  it("goes away once the card is answered, and a second miss shows it again", () => {
    let s = reducer(missOnlyCard(), { type: "acknowledgeRepeat" });
    s = run([{ type: "reveal" }, answer("again", "learning"), { type: "pick" }], s);
    expect(s.repeatNotice).toBe(true);
  });

  it("is not shown for a card that was not just missed", () => {
    const s = run([
      { type: "fetched", cards: [card("a"), card("b")] },
      { type: "pick" },
      answer("again", "learning"),
      { type: "pick" }, // b
      answer("easy", "review"),
      { type: "pick" }, // a
    ]);
    expect(s.current?.id).toBe("a");
    expect(s.repeatNotice).toBe(false);
  });
});

describe("ending a session early", () => {
  const started = () =>
    run([{ type: "fetched", cards: ids(5) }, { type: "pick" }, answer("good", "learning"), { type: "pick" }]);

  it("moves to the finished phase straight away, keeping what was answered", () => {
    const s = reducer(started(), { type: "end" });
    expect(phaseOf(s)).toBe("done");
    expect(s.stats).toMatchObject({ reviewed: 1, good: 1 });
    expect(s.handled).toEqual(["c1"]);
  });

  it("can be done from any phase, including before anything has loaded", () => {
    expect(phaseOf(reducer(initialState, { type: "end" }))).toBe("done");
    expect(phaseOf(reducer(reducer(initialState, { type: "fetchFailed" }), { type: "end" }))).toBe("done");
  });

  it("is harmless to do twice", () => {
    const once = reducer(started(), { type: "end" });
    expect(reducer(once, { type: "end" })).toBe(once);
  });

  it("still counts an answer that was being saved when the session ended", () => {
    const s = run([{ type: "end" }, answer("easy", "review")], started());
    expect(phaseOf(s)).toBe("done");
    expect(s.stats).toMatchObject({ reviewed: 2, good: 1, easy: 1 });
  });
});

describe("the number of cards left", () => {
  const fetchedNew = (n: number, moreNew: number): Action => ({ type: "fetched", cards: ids(n), moreNew });
  const left = (actions: Action[]) => remaining(run(actions));

  it("counts down for every answered card when there are no more new cards to come", () => {
    const start: Action[] = [fetchedNew(3, 0), { type: "pick" }];
    expect(left(start)).toBe(3);
    expect(left([...start, answer("good", "learning")])).toBe(2);
    expect(left([...start, answer("easy", "review")])).toBe(2);
  });

  it("does not count down for a new card answered Good or Easy, since another new card takes its place", () => {
    const start: Action[] = [fetchedNew(3, 5), { type: "pick" }];
    expect(left(start)).toBe(3);
    expect(left([...start, answer("good", "learning")])).toBe(3);
    expect(left([...start, answer("easy", "review")])).toBe(3);
  });

  it("does count down for a new card answered Hard, which uses up the daily limit", () => {
    const start: Action[] = [fetchedNew(3, 5), { type: "pick" }];
    expect(left([...start, answer("hard", "learning")])).toBe(2);
  });

  it("stays the same for Again, as the card is shown once more", () => {
    const start: Action[] = [fetchedNew(3, 5), { type: "pick" }];
    expect(left([...start, answer("again", "learning")])).toBe(3);
  });

  it("only makes room for as many new cards as there are", () => {
    const start: Action[] = [fetchedNew(4, 2), { type: "pick" }];
    const two = [...start, answer("good", "learning"), { type: "pick" } as Action, answer("good", "learning")];
    expect(left(two)).toBe(4 - 2 + 2); // two answered, two made room for
    const three = [...two, { type: "pick" } as Action, answer("good", "learning")];
    expect(left(three)).toBe(4 - 3 + 2); // no more room: it counts down again
  });

  it("does not count down for a card that was already being studied", () => {
    const studied = { ...card("s"), state: "review" as const };
    const actions: Action[] = [{ type: "fetched", cards: [studied, card("b"), card("c")], moreNew: 5 }, { type: "pick" }];
    expect(left([...actions, answer("good", "review")])).toBe(2); // it counts down: not a new card
  });

  it("forgets what was made room for once the next batch arrives, and takes the new figure", () => {
    const s = run([fetchedNew(2, 3), { type: "pick" }, answer("good", "learning"), { type: "pick" }, answer("good", "learning")]);
    expect(s.unlocked).toBe(2);
    const next = reducer(s, { type: "fetched", cards: ids(2, 10), moreNew: 1 });
    expect(next.unlocked).toBe(0);
    expect(next.moreNew).toBe(1);
    expect(remaining(next)).toBe(2);
  });

  it("treats a batch with no figure as having no more new cards", () => {
    const s = run([{ type: "fetched", cards: ids(2) }, { type: "pick" }, answer("good", "learning")]);
    expect(remaining(s)).toBe(1);
  });
});

