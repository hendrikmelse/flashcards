import { describe, expect, it } from "vitest";
import { endOfTomorrow, isValidTimeZone, studyDayStart } from "../src/study/day.js";

const start = (now: string, tz: string) => studyDayStart(new Date(now), tz).toISOString();

describe("studyDayStart", () => {
  it("starts the day at 04:00 UTC for UTC users", () => {
    expect(start("2026-03-10T10:00:00Z", "UTC")).toBe("2026-03-10T04:00:00.000Z");
  });

  it("counts the hours before 04:00 toward the previous day", () => {
    expect(start("2026-03-10T03:59:00Z", "UTC")).toBe("2026-03-09T04:00:00.000Z");
    expect(start("2026-03-10T04:00:00Z", "UTC")).toBe("2026-03-10T04:00:00.000Z");
  });

  it("respects the user's timezone, east of UTC", () => {
    // Amsterdam is UTC+1 in winter: 04:00 local is 03:00Z.
    expect(start("2026-01-15T10:00:00Z", "Europe/Amsterdam")).toBe("2026-01-15T03:00:00.000Z");
    // 03:30 local is still the previous study day.
    expect(start("2026-01-15T02:30:00Z", "Europe/Amsterdam")).toBe("2026-01-14T03:00:00.000Z");
    // UTC+2 in summer.
    expect(start("2026-07-01T10:00:00Z", "Europe/Amsterdam")).toBe("2026-07-01T02:00:00.000Z");
    // Tokyo is UTC+9: 19:00 local on the 15th, day began 04:00 local that day.
    expect(start("2026-01-15T10:00:00Z", "Asia/Tokyo")).toBe("2026-01-14T19:00:00.000Z");
  });

  it("respects the user's timezone, west of UTC", () => {
    // New York is UTC-5 in winter.
    expect(start("2026-01-15T10:00:00Z", "America/New_York")).toBe("2026-01-15T09:00:00.000Z");
  });

  it("handles the daylight-saving switch day", () => {
    // US clocks jump forward at 02:00 on 2026-03-08; 04:00 local is already EDT (UTC-4).
    expect(start("2026-03-08T15:00:00Z", "America/New_York")).toBe("2026-03-08T08:00:00.000Z");
    // The day after the change, and the day before, keep their own offsets.
    expect(start("2026-03-09T15:00:00Z", "America/New_York")).toBe("2026-03-09T08:00:00.000Z");
    expect(start("2026-03-07T15:00:00Z", "America/New_York")).toBe("2026-03-07T09:00:00.000Z");
  });

  it("falls back to UTC for an invalid timezone", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(start("2026-03-10T10:00:00Z", "Not/AZone")).toBe("2026-03-10T04:00:00.000Z");
  });
});

describe("endOfTomorrow", () => {
  const end = (now: string, tz: string) => endOfTomorrow(new Date(now), tz).toISOString();

  it("is when the day after tomorrow's study day begins", () => {
    expect(end("2026-03-10T10:00:00Z", "UTC")).toBe("2026-03-12T04:00:00.000Z");
  });

  it("still belongs to the previous study day before 04:00", () => {
    // 03:00 on the 10th is still the 9th's study day, so tomorrow is the 10th.
    expect(end("2026-03-10T03:00:00Z", "UTC")).toBe("2026-03-11T04:00:00.000Z");
  });

  it("follows the user's time zone", () => {
    // 04:00 in Amsterdam (UTC+1) is 03:00Z.
    expect(end("2026-01-15T10:00:00Z", "Europe/Amsterdam")).toBe("2026-01-17T03:00:00.000Z");
  });

  it("handles the clocks changing", () => {
    // Amsterdam springs forward on 29 March 2026, so 04:00 there on the 30th is 02:00Z.
    expect(end("2026-03-28T10:00:00Z", "Europe/Amsterdam")).toBe("2026-03-30T02:00:00.000Z");
  });
});
