import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseSentence, sentenceMarkupProblem, sentenceText } from "@flashcards/shared";
import { Sentences } from "./components/CardParts";

// The words picked out, in order.
const words = (sentence: string) =>
  parseSentence(sentence)
    .filter((p) => p.word)
    .map((p) => p.text);

describe("reading the marked word of a sentence", () => {
  it("takes the word between asterisks, and leaves the rest", () => {
    expect(parseSentence("De kinderen spelen een *spel*.")).toEqual([
      { text: "De kinderen spelen een ", word: false },
      { text: "spel", word: true },
      { text: ".", word: false },
    ]);
  });

  it("takes every marked word, such as the two parts of a separable verb", () => {
    expect(words("Ik *doe* mijn jas *aan*.")).toEqual(["doe", "aan"]);
  });

  it("takes a marked phrase, a word at the start, and part of a word", () => {
    expect(words("*Good luck* with your exam!")).toEqual(["Good luck"]);
    expect(words("Wat is je lievelings*kleur*?")).toEqual(["kleur"]);
  });

  it("keeps every character of the sentence apart from the asterisks", () => {
    const sentence = "The *dog*, my friend’s *dog*, barks.";
    expect(parseSentence(sentence).map((p) => p.text).join("")).toBe(sentenceText(sentence));
    expect(sentenceText(sentence)).toBe("The dog, my friend’s dog, barks.");
  });

  it("shows a sentence without marks as plain text", () => {
    expect(parseSentence("Nothing marked.")).toEqual([{ text: "Nothing marked.", word: false }]);
    expect(parseSentence("")).toEqual([]);
  });

  it("says what is wrong with a sentence's marks", () => {
    expect(sentenceMarkupProblem("The *dog* barks.")).toBeNull();
    expect(sentenceMarkupProblem("The dog barks.")).toMatch(/no \*word\*/);
    expect(sentenceMarkupProblem("The *dog* barks *loudly.")).toMatch(/asterisk/);
    expect(sentenceMarkupProblem("The **dog** barks.")).toMatch(/asterisk/);
  });
});

describe("the sentences on a card", () => {
  it("show the marked word in bold, apart from the rest of the sentence", () => {
    const { container } = render(<Sentences items={["The *periodic table* lists the elements."]} language="en" />);
    const p = container.querySelector("p.sentence")!;
    expect(p.textContent).toBe("The periodic table lists the elements.");
    expect([...p.querySelectorAll(".sentence-word")].map((e) => e.textContent)).toEqual(["periodic table"]);
  });

  it("show a sentence as plain text when it marks nothing", () => {
    const { container } = render(<Sentences items={["Nothing to find."]} language="en" />);
    expect(container.querySelectorAll(".sentence-word")).toHaveLength(0);
    expect(container.querySelectorAll("p.sentence")).toHaveLength(1);
  });
});
