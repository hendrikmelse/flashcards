import type { EntryView, LanguageInfo } from "@flashcards/shared";

// "hond" -> "de hond" when the entry carries an article (Dutch).
export function displayLemma(e: EntryView): string {
  const article = e.details["article"];
  return typeof article === "string" && article ? `${article} ${e.lemma}` : e.lemma;
}

export function entriesFor(entries: EntryView[], language: string): EntryView[] {
  return entries.filter((e) => e.language === language);
}

/** The language's name, or its code in capitals if it is not in the list. */
export function languageName(languages: LanguageInfo[], code: string): string {
  return languages.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

/**
 * The attributes that mark a piece of text as being in a language (the card's, not the app's), so a
 * screen reader pronounces it right and the browser hyphenates and translates it correctly. Spread
 * it on the element holding the text. The codes are language tags (the schema documents them as
 * BCP 47), so any language added later works without a change here.
 *
 * `dir="auto"` takes the writing direction from the text itself, so a right-to-left language shows
 * correctly without a table of which languages are. (The page around it stays left to right.)
 */
export function langAttrs(code: string): { lang: string; dir: "auto" } {
  return { lang: code, dir: "auto" };
}
