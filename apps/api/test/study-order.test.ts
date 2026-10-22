import { describe, expect, it } from "vitest";
import { interleaveNew, seededRandom } from "@flashcards/shared";
import { pickNew } from "../src/study/order.js";

const news = (n: number) => Array.from({ length: n }, (_, i) => `n${i}`);
const others = (n: number) => Array.from({ length: n }, (_, i) => `o${i}`);
const positions = (list: string[]) => list.flatMap((x, i) => (x.startsWith("n") ? [i] : []));

describe("interleaveNew", () => {
  it("returns the other list when there are no new cards, and vice versa", () => {
    expect(interleaveNew([], others(3), Math.random)).toEqual(others(3));
    expect(interleaveNew(news(3), [], Math.random)).toEqual(news(3));
  });

  it("keeps both lists in their own order and loses nothing", () => {
    for (let seed = 0; seed < 20; seed++) {
      const out = interleaveNew(news(4), others(9), seededRandom(seed));
      expect(out).toHaveLength(13);
      expect(out.filter((x) => x.startsWith("n"))).toEqual(news(4));
      expect(out.filter((x) => x.startsWith("o"))).toEqual(others(9));
    }
  });

  it("starts with a new card, then 1 to 3 other cards between each pair of new cards", () => {
    for (let seed = 0; seed < 50; seed++) {
      const at = positions(interleaveNew(news(8), others(100), seededRandom(seed)));
      expect(at[0]).toBe(0);
      for (let i = 1; i < at.length; i++) {
        expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(2);
        expect(at[i]! - at[i - 1]!).toBeLessThanOrEqual(4);
      }
    }
  });

  it("uses every gap size, depending on the random numbers", () => {
    expect(interleaveNew(news(3), others(9), () => 0)).toEqual(["n0", "o0", "n1", "o1", "n2", "o2", "o3", "o4", "o5", "o6", "o7", "o8"]);
    expect(interleaveNew(news(2), others(9), () => 0.5).slice(0, 4)).toEqual(["n0", "o0", "o1", "n1"]);
    expect(interleaveNew(news(2), others(9), () => 0.99).slice(0, 5)).toEqual(["n0", "o0", "o1", "o2", "n1"]);
  });

  it("opens with a gap too when the others come first", () => {
    expect(interleaveNew(news(2), others(5), () => 0, { othersFirst: true })).toEqual(["o0", "n0", "o1", "n1", "o2", "o3", "o4"]);
  });

  it("puts the remaining new cards one after another when the other cards run out", () => {
    expect(interleaveNew(news(4), others(1), () => 0)).toEqual(["n0", "o0", "n1", "n2", "n3"]);
    expect(interleaveNew(news(3), [], () => 0)).toEqual(["n0", "n1", "n2"]);
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
