import {
  DUTCH_AUXILIARIES,
  FORM_KEYS,
  PRESENT_PRONOUNS,
  allVerbForms,
} from "@flashcards/shared";
import { z } from "zod";

// The reviewed content format. The files are the source of truth; the importer
// makes the database match them.
//
//   content/concepts/*.json   { "concepts": [ { key, gloss, entries }, ... ] }
//   content/packs/*.json      { slug, name, description?, concepts: [key, ...] }
//
// The concept files are the word library; how they are split across files is
// only for organizing. A pack is an ordered list of concept keys, so the same
// concept can be in any number of packs. A concept's key is its permanent
// identity (the gloss is free text and can be reworded); entries and sentences
// are matched within their concept by language and lemma / text.

// Lowercase words joined by hyphens, e.g. "dog" or "know-fact".
export const KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const PARTS_OF_SPEECH = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "preposition",
  "pronoun",
  "conjunction",
  "numeral",
  "interjection",
  "phrase",
] as const;

// Every concept must have entries in these, or a card in one of the directions
// could not be built.
export const REQUIRED_LANGUAGES = ["en", "nl"] as const;

const entrySchema = z.object({
  lemma: z.string().trim().min(1),
  pos: z.enum(PARTS_OF_SPEECH),
  // Language-specific extras, e.g. { article: "de", plural: "honden" } for Dutch nouns.
  details: z.record(z.string(), z.unknown()).default({}),
  sentences: z.array(z.string().trim().min(1)).default([]),
});

const keySchema = z.string().regex(KEY_PATTERN, "lowercase letters, digits and hyphens");

export const conceptSchema = z.object({
  key: keySchema,
  gloss: z.string().trim().min(1),
  entries: z.record(z.string(), z.array(entrySchema).min(1)),
});

export const conceptFileSchema = z.object({
  concepts: z.array(conceptSchema).min(1),
});

export const packFileSchema = z.object({
  slug: keySchema,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  // Concept keys, in study order.
  concepts: z.array(keySchema).min(1),
});

export type Concept = z.infer<typeof conceptSchema>;
export type PackFile = z.infer<typeof packFileSchema>;
export type ConceptEntry = z.infer<typeof entrySchema>;

export interface Check {
  errors: string[];
  warnings: string[];
}

// Checks one concept beyond the JSON shape. Errors block the import; warnings
// are things a reviewer should look at but that can be legitimate.
export function checkConcept(concept: Concept): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  const where = `"${concept.key}"`;

  for (const lang of REQUIRED_LANGUAGES) {
    if (!concept.entries[lang]) errors.push(`${where}: no ${lang} entry`);
  }

  for (const [lang, entries] of Object.entries(concept.entries)) {
    const lemmas = new Set<string>();
    for (const entry of entries) {
      const at = `${where} ${lang} "${entry.lemma}"`;
      if (lemmas.has(entry.lemma)) errors.push(`${at}: duplicate lemma`);
      lemmas.add(entry.lemma);

      if (entry.pos === "noun") {
        if (lang === "nl") {
          const article = entry.details["article"];
          if (article !== "de" && article !== "het") {
            errors.push(`${at}: Dutch nouns need details.article of "de" or "het"`);
          }
        }
        if (typeof entry.details["plural"] !== "string" && entry.details["uncountable"] !== true) {
          warnings.push(`${at}: no details.plural (set details.uncountable if it has none)`);
        }
      }

      if (entry.pos === "verb") checkVerbForms(at, lang, entry, errors, warnings);

      if (entry.sentences.length === 0) {
        warnings.push(`${at}: no example sentence`);
      }
      // Inflected forms (plurals, "an" for "a") legitimately miss the lemma,
      // so this is only a prompt to look, not an error. Verbs may use any
      // stored form instead.
      if (entry.pos !== "phrase") {
        const candidates =
          entry.pos === "verb"
            ? [entry.lemma, ...stems(entry.lemma), ...allVerbForms(lang, entry.details)]
            : [entry.lemma];
        for (const s of entry.sentences) {
          const hay = squash(s);
          if (!candidates.some((c) => hay.includes(squash(c)))) {
            warnings.push(`${at}: sentence does not contain the lemma or a stored form: "${s}"`);
          }
        }
      }
    }
  }
  return { errors, warnings };
}

// Lowercase and collapse doubled letters, so Dutch spelling alternations
// (woon / won, maak / mak) do not hide a match.
function squash(s: string): string {
  return s.toLowerCase().replace(/(.)\1/g, "$1");
}

// Regular present-tense forms are not stored, so match on the stem
// ("werken" -> "werk", "kopen" -> "kop"), including the Dutch final-consonant
// devoicing (geven -> geef, lezen -> lees; squash() absorbs the vowel
// doubling). Lemmas such as "houden van" use the first word.
function stems(lemma: string): string[] {
  const first = lemma.split(" ")[0]!;
  const stem = first.replace(/(en|n)$/, "");
  const devoiced = stem.replace(/v$/, "f").replace(/z$/, "s");
  return [...new Set([stem, devoiced])].filter((s) => s.length >= 2);
}

function checkVerbForms(
  at: string,
  lang: string,
  entry: ConceptEntry,
  errors: string[],
  warnings: string[],
) {
  const d = entry.details;
  if (d["defective"] === true) return;

  for (const key of FORM_KEYS[lang] ?? []) {
    const v = d[key];
    if (v === undefined) warnings.push(`${at}: no details.${key} (set details.defective if the verb lacks it)`);
    else if (typeof v !== "string" || !v.trim()) errors.push(`${at}: details.${key} must be a non-empty string`);
  }
  if (lang === "nl" && d["auxiliary"] !== undefined) {
    if (!(DUTCH_AUXILIARIES as readonly string[]).includes(d["auxiliary"] as string)) {
      errors.push(`${at}: details.auxiliary must be one of ${DUTCH_AUXILIARIES.join(", ")}`);
    }
  }

  const present = d["present"];
  if (present !== undefined) {
    const pronouns = PRESENT_PRONOUNS[lang];
    if (!pronouns || typeof present !== "object" || present === null || Array.isArray(present)) {
      errors.push(`${at}: details.present must be an object keyed by pronoun`);
    } else {
      for (const [k, v] of Object.entries(present)) {
        if (!pronouns.includes(k)) errors.push(`${at}: details.present has unknown pronoun "${k}" (use ${pronouns.join(", ")})`);
        if (typeof v !== "string" || !v.trim()) errors.push(`${at}: details.present.${k} must be a non-empty string`);
      }
      for (const p of pronouns) {
        if (!(p in present)) warnings.push(`${at}: details.present has no "${p}" form`);
      }
    }
  }
}
