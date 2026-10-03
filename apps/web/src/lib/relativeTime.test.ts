import { describe, expect, it } from "vitest";
import { formatUntil } from "./relativeTime";

const NOW = "2026-01-15T10:00:00.000Z";
const at = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();

describe("formatUntil", () => {
  it("rounds to the most natural unit", () => {
    expect(formatUntil(at(20_000), NOW)).toBe("in under a minute");
    expect(formatUntil(at(5 * 60_000), NOW)).toBe("in 5 minutes");
    expect(formatUntil(at(60_000), NOW)).toBe("in 1 minute");
    expect(formatUntil(at(3 * 3_600_000), NOW)).toBe("in 3 hours");
    expect(formatUntil(at(23 * 3_600_000), NOW)).toBe("in 23 hours");
    expect(formatUntil(at(24 * 3_600_000), NOW)).toBe("in 1 day");
    expect(formatUntil(at(30 * 3_600_000), NOW)).toBe("in 1 day");
    expect(formatUntil(at(48 * 3_600_000), NOW)).toBe("in 2 days");
    expect(formatUntil(at(47 * 3_600_000), NOW)).toBe("in 2 days");
    expect(formatUntil(at(3 * 86_400_000), NOW)).toBe("in 3 days");
  });

  it("never shows a number the next unit up would cover", () => {
    const MIN = 60_000;
    expect(formatUntil(at(59.6 * MIN), NOW)).toBe("in 1 hour");
    expect(formatUntil(at(59.4 * MIN), NOW)).toBe("in 59 minutes");
    expect(formatUntil(at(23.6 * 60 * MIN), NOW)).toBe("in 1 day");
    expect(formatUntil(at(23.4 * 60 * MIN), NOW)).toBe("in 23 hours");
    expect(formatUntil(at(23.99 * 60 * MIN), NOW)).toBe("in 1 day");
    expect(formatUntil(at(47.6 * 60 * MIN), NOW)).toBe("in 2 days");
  });

  it("never goes negative", () => {
    expect(formatUntil(at(-5 * 60_000), NOW)).toBe("in under a minute");
  });
});
