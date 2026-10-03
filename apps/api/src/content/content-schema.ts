import {
  DUTCH_AUXILIARIES,
  LANGUAGE_CODES,
  PACK_CATEGORIES,
  REQUIRED_LANGUAGES,
  allVerbForms,
  languageCodeSchema,
  presentPronouns,
  verbFormKeys,
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
  "determiner",
  "particle",
  "proper noun",
  "phrase",
] as const;

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

// content/languages/<code>/*.json: one language's entries for concepts defined in
// content/concepts. Lets a language be added, reviewed and licensed on its own, without touching
// the shared concept files.
export const languageFileSchema = z.object({
  language: z.string().trim().min(1),
  concepts: z
    .array(z.object({ key: keySchema, entries: z.array(entrySchema).min(1) }))
    .min(1),
});

export type LanguageFile = z.infer<typeof languageFileSchema>;

export const packFileSchema = z.object({
  slug: keySchema,
  name: z.string().trim().min(1),
  // How the pack is grouped when browsing; see PACK_CATEGORIES.
  category: z.enum(PACK_CATEGORIES),
  // The language the pack was built for (a frequency list, a language's grammar words). Learners
  // of other languages are not shown it. Leave out for a pack that suits any language.
  language: languageCodeSchema.optional(),
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
export function checkConcept(concept: Concept, languages: readonly string[] = LANGUAGE_CODES): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  const where = `"${concept.key}"`;

  // Every concept must have entries in the required languages, or a card in one of the
  // directions could not be built.
  for (const lang of REQUIRED_LANGUAGES) {
    if (!concept.entries[lang]) errors.push(`${where}: no ${lang} entry`);
  }

  for (const [lang, entries] of Object.entries(concept.entries)) {
    if (!languages.includes(lang)) {
      errors.push(`${where}: unknown language "${lang}" (known: ${languages.join(", ")})`);
      continue;
    }
    checkEntries(where, lang, entries, errors, warnings);
  }
  return { errors, warnings };
}

// Checks one language's entries of a concept: what applies to every language, and what that
// language's rules add. `where` names the concept for the messages.
export function checkEntries(
  where: string,
  lang: string,
  entries: ConceptEntry[],
  errors: string[],
  warnings: string[],
) {
  const rules = LANGUAGE_RULES[lang];
  const lemmas = new Set<string>();
  for (const entry of entries) {
    const at = `${where} ${lang} "${entry.lemma}"`;
    if (lemmas.has(entry.lemma)) errors.push(`${at}: duplicate lemma`);
    lemmas.add(entry.lemma);

    if (entry.pos === "noun") {
      errors.push(...(rules?.nounErrors?.(entry.details) ?? []).map((e) => `${at}: ${e}`));
      if (
        typeof entry.details["plural"] !== "string" &&
        entry.details["uncountable"] !== true &&
        entry.details["pluralOnly"] !== true
      ) {
        warnings.push(`${at}: no details.plural (set details.uncountable if it has none)`);
      }
    }

    if (entry.pos === "verb") checkVerbForms(at, lang, entry, errors, warnings, rules);

    if (entry.sentences.length === 0) {
      warnings.push(`${at}: no example sentence`);
    }
    // Inflected forms (plurals, "an" for "a") legitimately miss the lemma,
    // so this is only a prompt to look, not an error. Verbs may use any
    // stored form instead.
    if (entry.pos !== "phrase") {
      // A separable verb splits in a sentence ("belde ... op"), so each word
      // of a stored form counts on its own too.
      const forms = entry.pos === "verb" ? allVerbForms(lang, entry.details) : [];
      // A lemma may carry a trailing qualifier, "bank (financial)", to tell
      // homographs apart on the card; the sentence only has the word.
      const bare = entry.lemma.replace(/\s*\([^)]*\)\s*$/, "");
      // "of, from" lists alternatives; any one of them in the sentence will do.
      const alternatives = bare.split(/,\s*/).filter(Boolean);
      const candidates =
        entry.pos === "verb"
          ? [
              ...alternatives,
              ...alternatives.flatMap(rules?.unstoredVerbForms ?? (() => [])),
              ...forms,
              ...forms.flatMap((f) => f.split(" ").filter((w) => w.length >= 3)),
            ]
          : alternatives;
      for (const s of entry.sentences) {
        const hay = squash(s);
        // A multi-word lemma ("what for") may be split in a sentence
        // ("What do you need it for?"), so all of its words appearing counts.
        const hasAllWords = (alt: string) => {
          const words = alt.split(/\s+/).filter((w) => w.length >= 2);
          return words.length > 1 && words.every((w) => hay.includes(squash(w)));
        };
        if (!candidates.some((c) => hay.includes(squash(c))) && !alternatives.some(hasAllWords)) {
          warnings.push(`${at}: sentence does not contain the lemma or a stored form: "${s}"`);
        }
      }
    }
  }
}

// Lowercase, drop accents and collapse doubled letters, so Dutch spelling
// alternations (woon / won, maak / mak, kopiëren / kopieer) do not hide a match.
function squash(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(.)\1/g, "$1");
}

// Regular present-tense forms are not stored, so match on the stem
// ("werken" -> "werk", "kopen" -> "kop"), including the Dutch final-consonant
// devoicing (geven -> geef, lezen -> lees; squash() absorbs the vowel
// doubling). Lemmas such as "houden van" use the first word.
function stems(lemma: string): string[] {
  const first = lemma.split(" ")[0]!;
  // A separable verb keeps its stem apart from the prefix in a main clause
  // ("Ik sta om zeven uur op"), so the stem without the prefix counts too.
  const prefix = SEPARABLE_PREFIXES.find((p) => first.startsWith(p) && first.length - p.length >= 4);
  const bases = prefix ? [first, first.slice(prefix.length)] : [first];
  return [
    ...new Set(
      bases.flatMap((word) => {
        const stem = word.replace(/(en|n)$/, "");
        return [stem, stem.replace(/v$/, "f").replace(/z$/, "s")];
      }),
    ),
  ].filter((s) => s.length >= 2);
}

const SEPARABLE_PREFIXES = [
  "terug", "binnen", "buiten", "samen", "weg", "neer", "door", "mee", "los", "vast", "thuis",
  "aan", "af", "bij", "in", "na", "om", "op", "uit", "toe", "voor", "over", "tegen", "achter",
];

// Regular English inflections that are not stored: third person (flies, goes,
// watches), and -ing with or without a doubled final consonant (running).
function englishVerbForms(lemma: string): string[] {
  const [first = "", ...rest] = lemma.split(" ");
  const tail = rest.length ? " " + rest.join(" ") : "";
  const third = /[^aeiou]y$/.test(first)
    ? first.slice(0, -1) + "ies"
    : /(s|x|z|ch|sh|o)$/.test(first)
      ? first + "es"
      : first + "s";
  const ing = [
    first.replace(/ie$/, "y").replace(/([^e])e$/, "$1") + "ing",
    first + first.slice(-1) + "ing",
  ];
  return [third, ...ing].map((f) => f + tail).concat(first);
}

// Checks that depend on the language of an entry. A language without an entry here gets only the
// checks that apply to every language.
type LanguageRules = {
  /** Problems with a noun's details, as sentences. */
  nounErrors?: (details: Record<string, unknown>) => string[];
  /** Problems with a verb's details beyond the keys every verb should have. */
  verbErrors?: (details: Record<string, unknown>) => string[];
  /** Regular forms of a verb that are not stored, so a sentence using one still counts as using it. */
  unstoredVerbForms?: (lemma: string) => string[];
};

const LANGUAGE_RULES: Record<string, LanguageRules> = {
  nl: {
    nounErrors(details) {
      const article = details["article"];
      return article === "de" || article === "het" ? [] : [`Dutch nouns need details.article of "de" or "het"`];
    },
    verbErrors(details) {
      const aux = details["auxiliary"];
      if (aux === undefined || (DUTCH_AUXILIARIES as readonly string[]).includes(aux as string)) return [];
      return [`details.auxiliary must be one of ${DUTCH_AUXILIARIES.join(", ")}`];
    },
    unstoredVerbForms: stems,
  },
  en: {
    unstoredVerbForms: englishVerbForms,
  },
};

function checkVerbForms(
  at: string,
  lang: string,
  entry: ConceptEntry,
  errors: string[],
  warnings: string[],
  rules: LanguageRules | undefined,
) {
  const d = entry.details;
  if (d["defective"] === true) return;

  for (const key of verbFormKeys(lang)) {
    const v = d[key];
    if (v === undefined) warnings.push(`${at}: no details.${key} (set details.defective if the verb lacks it)`);
    else if (typeof v !== "string" || !v.trim()) errors.push(`${at}: details.${key} must be a non-empty string`);
  }
  errors.push(...(rules?.verbErrors?.(d) ?? []).map((e) => `${at}: ${e}`));

  const present = d["present"];
  if (present !== undefined) {
    const pronouns = presentPronouns(lang);
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
