import { sql, type SQL } from "drizzle-orm";
import { LANGUAGE_CODES, infinitiveMarker } from "@flashcards/shared";

// The languages that put a marker in front of a verb's lemma ("to run"), and the marker.
const MARKERS = LANGUAGE_CODES.flatMap((code) => {
  const marker = infinitiveMarker(code);
  return marker ? [{ code, marker }] : [];
});

/**
 * An entry's lemma as people look for it and sort it: a verb's marker of the infinitive is left off
 * ("to run" is "run"), so that "run" is an exact match and the verb sorts under R. Takes the entry's
 * lemma, language and part of speech columns (or SQL for them), and works in the database like
 * `lemmaWithoutMarker` does in code.
 */
export function bareLemmaSql(lemma: SQL | object, language: SQL | object, partOfSpeech: SQL | object): SQL<string> {
  if (MARKERS.length === 0) return sql<string>`${lemma}`;
  const cases = MARKERS.map(
    ({ code, marker }) =>
      sql`when ${language} = ${code} and ${partOfSpeech} = 'verb' and ${lemma} like ${marker + " %"} then ltrim(substr(${lemma}, ${marker.length + 1}))`,
  );
  return sql<string>`(case ${sql.join(cases, sql` `)} else ${lemma} end)`;
}
