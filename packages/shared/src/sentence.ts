// Example sentences carry their own highlighting: the card's word is written between asterisks in the
// content ("De kinderen spelen een *spel*."), and a word in several places gets one pair for each
// ("Ik *doe* mijn jas *aan*."). The asterisks are part of the stored text; this is how they are read.

/** A piece of a sentence: `word` is true for the card's word, false for the rest. */
export interface SentencePart {
  text: string;
  word: boolean;
}

const MARKED = /\*([^*]+)\*/g;

/** Splits a sentence into the card's word and everything else, in order. */
export function parseSentence(sentence: string): SentencePart[] {
  const parts: SentencePart[] = [];
  let at = 0;
  for (const m of sentence.matchAll(MARKED)) {
    if (m.index! > at) parts.push({ text: sentence.slice(at, m.index!), word: false });
    parts.push({ text: m[1]!, word: true });
    at = m.index! + m[0].length;
  }
  if (at < sentence.length) parts.push({ text: sentence.slice(at), word: false });
  return parts;
}

/** The sentence as plain text, without the asterisks. */
export function sentenceText(sentence: string): string {
  return sentence.replace(MARKED, "$1");
}

/** What is wrong with the way a sentence marks its word, or null: none marked, or an asterisk left over. */
export function sentenceMarkupProblem(sentence: string): string | null {
  if (!sentence.match(MARKED)) return "no *word* is marked";
  if (sentenceText(sentence).includes("*")) return "has an asterisk that is not part of a *word* pair";
  return null;
}
