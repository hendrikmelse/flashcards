import { z } from "zod";

// The languages the app supports: the one place to add a new one. Adding a language is then:
//
//   1. Add its code and name below.
//   2. Run `seed-languages` against each database (it only inserts the ones that are missing).
//   3. Optionally draw its flag (apps/web/src/components/LanguageFlag.tsx; without one the code is
//      shown) and describe its word forms (forms.ts) and content checks (apps/api/src/content/
//      content-schema.ts); without those it simply has no forms and no extra checks.
//   4. Add entries for it to the content files. A language is not required to have entries for
//      every word (see REQUIRED_LANGUAGES), and a word can only become a card in a direction
//      whose two languages both have an entry for it.
//
// Names are written in the language itself, as they appear in the app.
const NAMES = {
  en: "English",
  nl: "Nederlands",
} as const;

export type LanguageCode = keyof typeof NAMES;

export const LANGUAGE_CODES = Object.keys(NAMES) as [LanguageCode, ...LanguageCode[]];

export const languageCodeSchema = z.enum(LANGUAGE_CODES);

export const LANGUAGES: readonly { code: LanguageCode; name: string }[] = LANGUAGE_CODES.map((code) => ({
  code,
  name: NAMES[code],
}));

/**
 * Languages every word in the content must have an entry for. The importer rejects a word without
 * one. New languages usually start out optional, so the existing words stay valid.
 */
export const REQUIRED_LANGUAGES: readonly LanguageCode[] = ["en", "nl"];

/**
 * The direction the Add words pages show words in, prompt language first. Words are added in this
 * direction and its opposite.
 */
export const ADD_WORDS_DIRECTION: { from: LanguageCode; to: LanguageCode } = { from: "en", to: "nl" };

// A language pair is the two languages a deck is about, whichever way round: "en-nl" covers the
// cards from English to Dutch and from Dutch to English. A user's cards for each pair are a deck
// of their own. The key puts the codes in alphabetical order, so a pair has one spelling.
export const PAIR_PATTERN = /^[a-z]{2,3}-[a-z]{2,3}$/;

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** The two language codes of a pair key. */
export function pairLanguages(pair: string): [string, string] {
  const [a = "", b = ""] = pair.split("-");
  return [a, b];
}
