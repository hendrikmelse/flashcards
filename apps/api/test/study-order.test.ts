import { describe, expect, it } from "vitest";
import { interleaveNew, pickNew } from "../src/study/order.js";

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

describe("pickNew", () => {
  const card = (word: string, dir: "en" | "nl") => ({ conceptId: word, dir, id: `${word}-${dir}` });
  const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

  it("takes the cards in order when no word has two", () => {
    const cards = [card("a", "en"), card("b", "en"), card("c", "en")];
    expect(ids(pickNew(cards, 2))).toEqual(["a-en", "b-en"]);
  });

  it("does not offer both directions of a word while there are other words to show", () => {
    // Added one word at a time: each word's two directions are side by side.
    const cards = [card("a", "en"), card("a", "nl"), card("b", "en"), card("b", "nl"), card("c", "en"), card("c", "nl")];
    expect(ids(pickNew(cards, 3))).toEqual(["a-en", "b-en", "c-en"]);
    expect(ids(pickNew(cards, 2))).toEqual(["a-en", "b-en"]);
  });

  it("offers the second directions, in order, once the words run out", () => {
    const cards = [card("a", "en"), card("a", "nl"), card("b", "en"), card("b", "nl")];
    expect(ids(pickNew(cards, 4))).toEqual(["a-en", "b-en", "a-nl", "b-nl"]);
    expect(ids(pickNew(cards, 3))).toEqual(["a-en", "b-en", "a-nl"]);
  });

  it("offers both directions of a single word, since there is nothing else", () => {
    expect(ids(pickNew([card("a", "en"), card("a", "nl")], 2))).toEqual(["a-en", "a-nl"]);
  });

  it("keeps the order when a pack was added (all forward, then all reverse)", () => {
    const cards = [card("a", "en"), card("b", "en"), card("a", "nl"), card("b", "nl")];
    expect(ids(pickNew(cards, 2))).toEqual(["a-en", "b-en"]);
    expect(ids(pickNew(cards, 4))).toEqual(["a-en", "b-en", "a-nl", "b-nl"]);
  });

  it("has enough to choose from in the first twice-the-limit cards", () => {
    // Worst case: every word's two directions are next to each other, so 2 * limit cards hold limit words.
    const cards = Array.from({ length: 10 }, (_, i) => [card(`w${i}`, "en"), card(`w${i}`, "nl")]).flat();
    const picked = pickNew(cards.slice(0, 2 * 4), 4);
    expect(new Set(picked.map((c) => c.conceptId)).size).toBe(4);
  });

  it("keeps a held card behind all the others, even if it is the only card of its word", () => {
    const held = { ...card("a", "nl"), held: true };
    const cards = [card("b", "en"), card("b", "nl"), card("c", "en"), held];
    expect(ids(pickNew(cards, 3))).toEqual(["b-en", "c-en", "b-nl"]);
    expect(ids(pickNew(cards, 4))).toEqual(["b-en", "c-en", "b-nl", "a-nl"]);
  });

  it("handles nothing, and a limit of nothing", () => {
    expect(pickNew([], 5)).toEqual([]);
    expect(pickNew([card("a", "en")], 0)).toEqual([]);
  });
});
