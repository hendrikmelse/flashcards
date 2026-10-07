import { allVerbForms } from "./forms.js";

// Finding the card's word in an example sentence, so the card can show it in bold among the rest of
// the sentence. The sentences are written to contain the word (the content check warns
// when one does not), but not always as the lemma: a noun may be plural, a verb conjugated, a Dutch
// separable verb split in two. This looks for the lemma, the stored forms, and the regular forms that
// are not stored (the same ones the content check accepts), and shows nothing special when it finds
// none, rather than guess.

/** The part of an entry this needs; `EntryView` fits. */
export interface WordEntry {
  language: string;
  lemma: string;
  partOfSpeech: string | null;
  details: Record<string, unknown>;
}

/** A piece of a sentence: `word` is true for the card's word, false for the rest. */
export interface SentencePart {
  text: string;
  word: boolean;
}

// Compared without case, accents, or doubled letters, so Dutch spelling alternations (woon / won,
// loss / los) do not hide a match.
const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/(.)\1/g, "$1");

/**
 * What to look for: the words of one phrase, and how a sentence's word may differ from them.
 * `prefix` is the shortest the phrase's words can be for a sentence word that only starts with it
 * to count (a plural, a conjugation); 0 means the sentence word must be exactly it.
 */
interface Needle {
  words: string[];
  prefix: number;
}

// The most letters a sentence word may add to a needle's word and still count as it: -en, -s, -e.
const MAX_EXTRA = 3;

const SEPARABLE_PREFIXES = [
  "terug", "binnen", "buiten", "samen", "weg", "neer", "door", "mee", "los", "vast", "thuis",
  "aan", "af", "bij", "in", "na", "om", "op", "uit", "toe", "voor", "over", "tegen", "achter",
];

// A Dutch verb's regular present tense is not stored, so its stem stands for it. A separable verb's
// stem is also found without its prefix, which sits apart from it in a main clause.
function dutchStems(lemma: string): string[] {
  const first = lemma.split(" ")[0] ?? "";
  const prefix = SEPARABLE_PREFIXES.find((p) => first.startsWith(p) && first.length - p.length >= 4);
  const bases = prefix ? [first, first.slice(prefix.length)] : [first];
  return bases.flatMap((word) => {
    const stem = word.replace(/(en|n)$/, "");
    return [stem, stem.replace(/v$/, "f").replace(/z$/, "s")];
  });
}

// An English verb's regular third person and -ing forms are not stored either.
function englishForms(lemma: string): string[] {
  const first = lemma.split(" ")[0] ?? "";
  const third = /[^aeiou]y$/.test(first)
    ? first.slice(0, -1) + "ies"
    : /(s|x|z|ch|sh|o)$/.test(first)
      ? first + "es"
      : first + "s";
  return [
    third,
    first.replace(/ie$/, "y").replace(/([^e])e$/, "$1") + "ing",
    first + first.slice(-1) + "ing",
    first,
  ];
}

function needlesFor(entry: WordEntry): Needle[] {
  const needles: Needle[] = [];
  // "bank (financial)" is shown to tell homographs apart; "of, from" lists alternatives.
  const bare = entry.lemma.replace(/\s*\([^)]*\)\s*$/, "");
  for (const alternative of bare.split(/,\s*/)) {
    const words = alternative.split(/\s+/).map(norm).filter(Boolean);
    if (words.length > 0) needles.push({ words, prefix: 4 });
  }

  const forms: string[] = [];
  const plural = entry.details["plural"];
  if (typeof plural === "string") forms.push(plural);
  if (entry.partOfSpeech === "verb") {
    forms.push(...allVerbForms(entry.language, entry.details));
    if (entry.language === "nl") {
      for (const stem of dutchStems(entry.lemma)) needles.push({ words: [norm(stem)], prefix: 3 });
    } else if (entry.language === "en") {
      forms.push(...englishForms(entry.lemma));
    }
  }
  // A stored form is exactly that; of a form in several words ("loste op"), each word counts alone.
  for (const form of forms) {
    for (const word of form.split(/\s+/).map(norm)) if (word.length >= 3) needles.push({ words: [word], prefix: 0 });
  }
  return needles;
}

const matches = (token: string, word: string, prefix: number): boolean =>
  token === word ||
  (prefix > 0 && word.length >= prefix && token.startsWith(word) && token.length - word.length <= MAX_EXTRA);

/** Splits a sentence into the card's word and everything else, in order. */
export function highlightSentence(sentence: string, entries: readonly WordEntry[]): SentencePart[] {
  const tokens = [...sentence.matchAll(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu)].map((m) => ({
    start: m.index!,
    end: m.index! + m[0].length,
    norm: norm(m[0]),
  }));

  const hit = new Set<number>();
  for (const needle of entries.flatMap(needlesFor)) {
    const n = needle.words.length;
    for (let i = 0; i + n <= tokens.length; i++) {
      let found = true;
      for (let k = 0; k < n && found; k++) {
        found = matches(tokens[i + k]!.norm, needle.words[k]!, needle.prefix);
        // The words of a phrase follow each other with only spaces between.
        if (found && k > 0 && !/^\s+$/.test(sentence.slice(tokens[i + k - 1]!.end, tokens[i + k]!.start))) found = false;
      }
      if (found) for (let k = 0; k < n; k++) hit.add(i + k);
    }
  }
  if (hit.size === 0) return [{ text: sentence, word: false }];

  const parts: SentencePart[] = [];
  let at = 0;
  tokens.forEach((t, i) => {
    if (!hit.has(i)) return;
    if (t.start > at) parts.push({ text: sentence.slice(at, t.start), word: false });
    parts.push({ text: sentence.slice(t.start, t.end), word: true });
    at = t.end;
  });
  if (at < sentence.length) parts.push({ text: sentence.slice(at), word: false });
  return mergeNeighbours(parts);
}

// "periodic" and "table" are two hits side by side: shown as one run, with the space between them in
// the same color.
function mergeNeighbours(parts: SentencePart[]): SentencePart[] {
  const out: SentencePart[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const prev = out[out.length - 1];
    const next = parts[i + 1];
    if (prev?.word && part.word) {
      prev.text += part.text;
    } else if (!part.word && /^\s+$/.test(part.text) && prev?.word && next?.word) {
      prev.text += part.text;
    } else {
      out.push({ ...part });
    }
  }
  return out;
}
