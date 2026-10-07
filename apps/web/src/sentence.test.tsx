import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { highlightSentence, type EntryView } from "@flashcards/shared";
import { Sentences } from "./components/CardParts";

const entry = (language: string, lemma: string, partOfSpeech: string, details: Record<string, unknown> = {}): EntryView => ({
  language,
  lemma,
  partOfSpeech,
  details,
});

// The words picked out, in order.
const words = (sentence: string, entries: EntryView[]) =>
  highlightSentence(sentence, entries)
    .filter((p) => p.word)
    .map((p) => p.text);

describe("finding the card's word in a sentence", () => {
  it("finds the lemma, whatever its case", () => {
    expect(words("The dog barks.", [entry("en", "dog", "noun", { plural: "dogs" })])).toEqual(["dog"]);
    expect(words("Dogs bark.", [entry("en", "dog", "noun", { plural: "dogs" })])).toEqual(["Dogs"]);
  });

  it("splits the sentence into the word and the rest, without losing a character", () => {
    const sentence = "The dog, my friend’s dog, barks.";
    const parts = highlightSentence(sentence, [entry("en", "dog", "noun")]);
    expect(parts.map((p) => p.text).join("")).toBe(sentence);
    expect(parts.filter((p) => p.word).map((p) => p.text)).toEqual(["dog", "dog"]);
  });

  it("finds a stored plural, and a plural that only adds a few letters", () => {
    expect(words("Er zijn veel mitochondriën.", [entry("nl", "mitochondrium", "noun", { plural: "mitochondriën" })])).toEqual([
      "mitochondriën",
    ]);
    expect(words("Both isotopes are stable.", [entry("en", "isotope", "noun")])).toEqual(["isotopes"]);
    expect(words("Ik zie twee honden.", [entry("nl", "hond", "noun", { article: "de" })])).toEqual(["honden"]);
  });

  it("finds all the words of a phrase together", () => {
    const parts = highlightSentence("The periodic table lists the elements.", [entry("en", "periodic table", "noun")]);
    expect(parts.filter((p) => p.word).map((p) => p.text)).toEqual(["periodic table"]);
    expect(words("Rode bloedcellen vervoeren zuurstof.", [entry("nl", "rode bloedcel", "noun")])).toEqual(["Rode bloedcellen"]);
  });

  it("does not take two separate words for a phrase", () => {
    expect(words("The table is periodic, and the chart is old.", [entry("en", "periodic table", "noun")])).toEqual([]);
  });

  it("ignores a lemma's qualifier, and takes any of its alternatives", () => {
    expect(words("Salt dissolves in water.", [entry("en", "dissolve (in a liquid)", "verb", { past: "dissolved", participle: "dissolved" })])).toEqual([
      "dissolves",
    ]);
    expect(words("We saw a bat.", [entry("en", "bat, club", "noun")])).toEqual(["bat"]);
  });

  it("finds a conjugated English verb", () => {
    const forms = { past: "dissolved", participle: "dissolved" };
    expect(words("The salt dissolved.", [entry("en", "dissolve", "verb", forms)])).toEqual(["dissolved"]);
    expect(words("It is dissolving fast.", [entry("en", "dissolve", "verb", forms)])).toEqual(["dissolving"]);
    expect(words("He ran home.", [entry("en", "run", "verb", { past: "ran", participle: "run" })])).toEqual(["ran"]);
  });

  it("finds a Dutch verb in its present tense, and the verb part of a separable one", () => {
    expect(words("Zij werkt hard.", [entry("nl", "werken", "verb", { pastSingular: "werkte", pastPlural: "werkten", participle: "gewerkt", auxiliary: "hebben" })])).toEqual([
      "werkt",
    ]);
    const separable = entry("nl", "oplossen", "verb", { pastSingular: "loste op", pastPlural: "losten op", participle: "opgelost", auxiliary: "hebben" });
    expect(words("Zout lost op in water.", [separable])).toEqual(["lost"]);
    expect(words("Het zout is opgelost.", [separable])).toEqual(["opgelost"]);
  });

  it("finds an inflected adjective", () => {
    expect(words("De tijger is een bedreigde diersoort.", [entry("nl", "bedreigd", "adjective")])).toEqual(["bedreigde"]);
  });

  it("ignores accents and doubled letters when comparing", () => {
    expect(words("Wij gaan naar het café.", [entry("nl", "cafe", "noun")])).toEqual(["café"]);
    expect(words("Wij gaan naar het cafe.", [entry("nl", "café", "noun")])).toEqual(["cafe"]);
    expect(words("Wij wonen hier.", [entry("nl", "wonen", "verb", { pastSingular: "woonde", pastPlural: "woonden", participle: "gewoond", auxiliary: "hebben" })])).toEqual(["wonen"]);
  });

  it("does not pick out a short word that only starts like the lemma", () => {
    expect(words("Ik ben in het inktpot-museum.", [entry("nl", "in", "preposition")])).toEqual(["in"]);
  });

  it("finds nothing, and leaves the sentence whole, when the word is not there", () => {
    const parts = highlightSentence("The sky is blue.", [entry("en", "dog", "noun")]);
    expect(parts).toEqual([{ text: "The sky is blue.", word: false }]);
    expect(highlightSentence("Anything at all.", [])).toEqual([{ text: "Anything at all.", word: false }]);
  });

  it("looks for the words of every entry of a side", () => {
    expect(words("The cat sees a hound.", [entry("en", "dog", "noun"), entry("en", "hound", "noun"), entry("en", "cat", "noun")])).toEqual([
      "cat",
      "hound",
    ]);
  });
});

describe("the sentences on a card", () => {
  it("show the card's word in bold, apart from the rest of the sentence", () => {
    const { container } = render(
      <Sentences items={["The periodic table lists the elements."]} language="en" entries={[entry("en", "periodic table", "noun")]} />,
    );
    const p = container.querySelector("p.sentence")!;
    expect(p.textContent).toBe("The periodic table lists the elements.");
    expect([...p.querySelectorAll(".sentence-word")].map((e) => e.textContent)).toEqual(["periodic table"]);
  });

  it("show a sentence as plain text without entries, or when the word is not in it", () => {
    const { container } = render(
      <>
        <Sentences items={["No entries given."]} language="en" />
        <Sentences items={["Nothing to find."]} language="en" entries={[entry("en", "dog", "noun")]} />
      </>,
    );
    expect(container.querySelectorAll(".sentence-word")).toHaveLength(0);
    expect(container.querySelectorAll("p.sentence")).toHaveLength(2);
  });
});
