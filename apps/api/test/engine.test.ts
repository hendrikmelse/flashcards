import { describe, expect, it } from "vitest";
import { createFsrsScheduler, newCardState } from "../src/srs/engine.js";
import { studyDayStart } from "../src/study/day.js";

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
    // Starts over from the first short step, like a new card.
    expect(minutes(lapsed.dueAt, later)).toBe(1);
  });

  it("takes a forgotten card through both steps again before it is back in review", () => {
    const learned = scheduler.review(newCardState(T0), "easy", T0);
    const lapsed = scheduler.review(learned, "again", learned.dueAt);

    const step2 = scheduler.review(lapsed, "good", lapsed.dueAt);
    expect(step2.state).toBe("relearning");
    expect(minutes(step2.dueAt, lapsed.dueAt)).toBe(10);

    const back = scheduler.review(step2, "good", step2.dueAt);
    expect(back.state).toBe("review");
    expect(back.intervalDays).toBeGreaterThanOrEqual(1);

    // Another Again at the second step goes back to the first.
    const again = scheduler.review(step2, "again", step2.dueAt);
    expect(again.state).toBe("relearning");
    expect(minutes(again.dueAt, step2.dueAt)).toBe(1);
  });

  describe("retrievability", () => {
    const day = 86_400_000;
    const reviewed = scheduler.review(newCardState(T0), "easy", T0);

    it("falls as time passes since the last review", () => {
      const soon = scheduler.retrievability(reviewed, new Date(reviewed.dueAt.getTime() - 3 * day));
      const due = scheduler.retrievability(reviewed, reviewed.dueAt);
      const late = scheduler.retrievability(reviewed, new Date(reviewed.dueAt.getTime() + 20 * day));
      // Before the due time it is measured at the due time, so it does not rise above it.
      expect(soon).toBeCloseTo(due, 10);
      expect(due).toBeGreaterThan(0.85);
      expect(due).toBeLessThan(0.95);
      expect(late).toBeLessThan(due);
    });

    it("is lower for a card the user knows less well, at the same age", () => {
      const weak = { ...reviewed, stability: 1 };
      const strong = { ...reviewed, stability: 50 };
      const at = new Date(reviewed.lastReviewedAt!.getTime() + 10 * day);
      expect(scheduler.retrievability(weak, at)).toBeLessThan(scheduler.retrievability(strong, at));
    });

    it("measures learning cards in minutes, not whole days", () => {
      const first = scheduler.review(newCardState(T0), "again", T0); // due in 1 minute
      const r = scheduler.retrievability(first, T0);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThan(1);
    });

    it("is zero when there is no memory estimate", () => {
      expect(scheduler.retrievability(newCardState(T0), T0)).toBe(0);
    });
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

describe("scheduling in whole study days", () => {
  const HOUR = 3_600_000;
  const opts = { dayStart: (d: Date) => studyDayStart(d, "UTC") }; // study days start at 04:00
  const afternoon = new Date("2026-03-10T15:00:00Z");
  const atStartOfDay = (d: Date) => d.getTime() === studyDayStart(d, "UTC").getTime();

  // A card that graduated to review in the afternoon.
  // `plain` schedules the way the algorithm does on its own, for comparison.
  const graduate = (now: Date, how: "days" | "plain" | typeof opts = "days") => {
    const o = how === "days" ? opts : how === "plain" ? undefined : how;
    const step = scheduler.review(newCardState(now), "good", now, o);
    return scheduler.review(step, "good", new Date(now.getTime() + 10 * 60_000), o);
  };

  it("keeps learning steps in real time", () => {
    const step = scheduler.review(newCardState(afternoon), "good", afternoon, opts);
    expect(step.state).toBe("learning");
    expect(step.dueAt.getTime()).toBe(afternoon.getTime() + 10 * 60_000);
  });

  it("makes a card that graduates in the afternoon due at the start of a day, not mid-day", () => {
    const withDays = graduate(afternoon);
    const plain = graduate(afternoon, "plain");
    expect(withDays.state).toBe("review");
    expect(atStartOfDay(withDays.dueAt)).toBe(true);
    // Earlier than it would have been, by less than a day.
    const earlier = plain.dueAt.getTime() - withDays.dueAt.getTime();
    expect(earlier).toBeGreaterThan(0);
    expect(earlier).toBeLessThan(24 * HOUR);
    // The interval itself is unchanged.
    expect(withDays.intervalDays).toBe(plain.intervalDays);
  });

  it("makes a card answered in the afternoon, due in about a day, available the next morning", () => {
    const learned = graduate(afternoon); // a couple of days out, at 04:00
    const dueDay = learned.dueAt;
    const reviewed = scheduler.review(learned, "hard", new Date(dueDay.getTime() + 11 * HOUR), opts); // 15:00 that day
    expect(reviewed.state).toBe("review");
    expect(atStartOfDay(reviewed.dueAt)).toBe(true);
    const nominal = scheduler.review(learned, "hard", new Date(dueDay.getTime() + 11 * HOUR));
    // "Normally" mid-afternoon `intervalDays` later; now at 04:00 that day instead.
    expect(nominal.dueAt.getTime() - reviewed.dueAt.getTime()).toBeGreaterThan(0);
    expect(nominal.dueAt.getTime() - reviewed.dueAt.getTime()).toBeLessThan(24 * HOUR);
  });

  it("gives the same result whatever time of day a due card is reviewed", () => {
    const learned = graduate(afternoon);
    const early = scheduler.review(learned, "good", new Date(learned.dueAt.getTime() + 1 * HOUR), opts); // 05:00
    const late = scheduler.review(learned, "good", new Date(learned.dueAt.getTime() + 19.5 * HOUR), opts); // 23:30
    expect(early.stability).toBe(late.stability);
    expect(early.difficulty).toBe(late.difficulty);
    expect(early.intervalDays).toBe(late.intervalDays);
    expect(early.dueAt.getTime()).toBe(late.dueAt.getTime());
  });

  it("does not treat a morning review of a card due that day as an early review", () => {
    // Without whole-day handling, reviewing at 05:00 the morning a card became due would look
    // like a review about 10 hours short of the scheduled gap, and grow the interval less.
    const learned = graduate(afternoon);
    const morning = new Date(learned.dueAt.getTime() + 1 * HOUR);
    const withDays = scheduler.review(learned, "good", morning, opts);
    const onTime = scheduler.review(learned, "good", new Date(learned.dueAt.getTime() + 11 * HOUR), opts);
    expect(withDays.intervalDays).toBe(onTime.intervalDays);
  });

  it("sends a forgotten card back for a short step counted from the real time", () => {
    const learned = graduate(afternoon);
    const when = new Date(learned.dueAt.getTime() + 19.5 * HOUR); // 23:30
    const lapsed = scheduler.review(learned, "again", when, opts);
    expect(lapsed.state).toBe("relearning");
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.dueAt.getTime()).toBe(when.getTime() + 60_000);
    expect(lapsed.lastReviewedAt).toEqual(when);
  });

  it("records the real time of the review", () => {
    const learned = graduate(afternoon);
    const when = new Date(learned.dueAt.getTime() + 7 * HOUR);
    expect(scheduler.review(learned, "good", when, opts).lastReviewedAt).toEqual(when);
  });

  it("follows the time zone", () => {
    const amsterdam = { dayStart: (d: Date) => studyDayStart(d, "Europe/Amsterdam") };
    const card = graduate(afternoon, amsterdam);
    expect(card.dueAt.getTime()).toBe(studyDayStart(card.dueAt, "Europe/Amsterdam").getTime());
    expect(card.dueAt.getUTCHours()).toBe(3); // 04:00 in Amsterdam in winter is 03:00Z
  });
});
