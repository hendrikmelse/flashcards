import { describe, expect, it } from "vitest";
import { interleaveNew } from "../src/study/order.js";

const news = (n: number) => Array.from({ length: n }, (_, i) => `n${i}`);
const others = (n: number) => Array.from({ length: n }, (_, i) => `o${i}`);
const positions = (list: string[]) => list.flatMap((x, i) => (x.startsWith("n") ? [i] : []));

describe("interleaveNew", () => {
  it("returns the other list when there are no new cards, and vice versa", () => {
    expect(interleaveNew([], others(3))).toEqual(others(3));
    expect(interleaveNew(news(3), [])).toEqual(news(3));
  });

  it("keeps both lists in their own order and loses nothing", () => {
    const out = interleaveNew(news(4), others(9));
    expect(out).toHaveLength(13);
    expect(out.filter((x) => x.startsWith("n"))).toEqual(news(4));
    expect(out.filter((x) => x.startsWith("o"))).toEqual(others(9));
  });

  it("spreads new cards evenly through the first half of the queue", () => {
    const out = interleaveNew(news(20), others(200)); // 220 cards, so the first 110
    const at = positions(out);
    expect(at).toHaveLength(20);
    expect(at[19]!).toBeLessThan(110);
    // Roughly every fifth or sixth card, never bunched together.
    for (let i = 1; i < at.length; i++) {
      expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(5);
      expect(at[i]! - at[i - 1]!).toBeLessThanOrEqual(6);
    }
    expect(out.slice(0, 5)).toContain("n0");
  });

  it("puts new cards first when there are not many other cards", () => {
    expect(interleaveNew(news(3), others(2))).toEqual(["n0", "n1", "n2", "o0", "o1"]);
  });

  it("with one new card among a few, puts it in the middle of the front half", () => {
    expect(interleaveNew(news(1), others(3))).toEqual(["o0", "n0", "o1", "o2"]);
  });

  it("never places a new card past the end, whatever the sizes", () => {
    for (let n = 1; n <= 12; n++) {
      for (let o = 1; o <= 12; o++) {
        const out = interleaveNew(news(n), others(o));
        expect(out).toHaveLength(n + o);
        expect(new Set(out).size).toBe(n + o);
        expect(positions(out)).toHaveLength(n);
      }
    }
  });
});
