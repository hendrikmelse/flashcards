import type { EntryView } from "@flashcards/shared";

// "hond" -> "de hond" when the entry carries an article (Dutch).
export function displayLemma(e: EntryView): string {
  const article = e.details["article"];
  return typeof article === "string" && article ? `${article} ${e.lemma}` : e.lemma;
}

export function entriesFor(entries: EntryView[], language: string): EntryView[] {
  return entries.filter((e) => e.language === language);
}
