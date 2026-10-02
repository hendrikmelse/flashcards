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
    expect(formatUntil(at(47 * 3_600_000), NOW)).toBe("in 47 hours");
    expect(formatUntil(at(3 * 86_400_000), NOW)).toBe("in 3 days");
  });

  it("never goes negative", () => {
    expect(formatUntil(at(-5 * 60_000), NOW)).toBe("in under a minute");
  });
});
