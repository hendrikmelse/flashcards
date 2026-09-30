import { describe, expect, it } from "vitest";
import { createFsrsScheduler, newCardState } from "../src/srs/engine.js";

const scheduler = createFsrsScheduler({ fuzz: false });
const T0 = new Date("2026-03-10T12:00:00Z");
const minutes = (d: Date, from: Date) => (d.getTime() - from.getTime()) / 60_000;

describe("FSRS scheduler", () => {
  it("starts new cards in the new state", () => {
    const s = newCardState(T0);
    expect(s).toMatchObject({ state: "new", repetitions: 0, lapses: 0, stability: null });
  });

  it("moves a new card into learning with short steps", () => {
    const again = scheduler.review(newCardState(T0), "again", T0);
    expect(again.state).toBe("learning");
    expect(minutes(again.dueAt, T0)).toBe(1);

    const good = scheduler.review(newCardState(T0), "good", T0);
    expect(good.state).toBe("learning");
    expect(minutes(good.dueAt, T0)).toBe(10);
    expect(good.stability).not.toBeNull();
    expect(good.difficulty).not.toBeNull();
  });

  it("graduates to review once the learning steps are done", () => {
    const step1 = scheduler.review(newCardState(T0), "good", T0);
    const T1 = step1.dueAt;
    const step2 = scheduler.review(step1, "good", T1);
    expect(step2.state).toBe("review");
    expect(step2.intervalDays).toBeGreaterThanOrEqual(1);
    expect(step2.lastReviewedAt).toEqual(T1);
  });

  it("graduates immediately on easy", () => {
    const easy = scheduler.review(newCardState(T0), "easy", T0);
    expect(easy.state).toBe("review");
    expect(easy.intervalDays).toBeGreaterThanOrEqual(1);
    expect(easy.repetitions).toBe(1);
  });

  it("sends a forgotten review card to relearning and counts the lapse", () => {
    const learned = scheduler.review(newCardState(T0), "easy", T0);
    const later = new Date(learned.dueAt);
    const lapsed = scheduler.review(learned, "again", later);
    expect(lapsed.state).toBe("relearning");
    expect(lapsed.lapses).toBe(1);
    expect(minutes(lapsed.dueAt, later)).toBe(10);
  });

  it("grows the interval across successful reviews", () => {
    let s = scheduler.review(newCardState(T0), "easy", T0);
    const first = s.intervalDays;
    s = scheduler.review(s, "good", s.dueAt);
    expect(s.intervalDays).toBeGreaterThan(first);
  });

  it("is pure: does not mutate its input and repeats deterministically", () => {
    const input = newCardState(T0);
    const snapshot = structuredClone(input);
    const a = scheduler.review(input, "good", T0);
    const b = scheduler.review(input, "good", T0);
    expect(input).toEqual(snapshot);
    expect(a).toEqual(b);
  });
});
