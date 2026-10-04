// Word forms live in an entry's `details` (jsonb, so key order is NOT kept):
//
//   nouns (every language): { plural }, { uncountable: true } or { pluralOnly: true }
//   nl: { pastSingular, pastPlural, participle, auxiliary, present? }
//       auxiliary is "hebben", "zijn" or "hebben/zijn"
//   en: { past, participle, present? }
//
// `present` is only stored for verbs whose present tense is irregular, as a
// map from pronoun to form. `defective: true` marks verbs that lack some forms
// (English "can", "must") and so are exempt from the completeness check.
//
// What each language's verbs have is described by its entry in LANGUAGE_FORMS below. A language
// with no entry has noun plurals only.

type FormLine = { label: string; value: string };

// Some plural lines are a note in the app's own language rather than a word form ("uncountable"
// is not a Dutch or English word form). Named so the UI can tell them apart: a word form is shown
// as being in the entry's language, a note is not.
export const UNCOUNTABLE_NOTE = "uncountable";
export const PLURAL_ONLY_NOTE = "plural only";

/** Whether a form line's value is a note in the app's language, not a form of the word. */
export const isFormNote = (value: string): boolean => value === UNCOUNTABLE_NOTE || value === PLURAL_ONLY_NOTE;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : undefined;

type LanguageForms = {
  /** Pronoun order for the present-tense table, since stored keys have no order. */
  presentPronouns: readonly string[];
  /** The details keys every verb should have (unless it is defective). */
  verbKeys: readonly string[];
  /** The verb lines shown on the back of a card, after the present tense. */
  verbLines: (details: Record<string, unknown>) => FormLine[];
};

export const DUTCH_AUXILIARIES = ["hebben", "zijn", "hebben/zijn"] as const;

// "hebben" -> "heeft", "zijn" -> "is": the third-person form that goes in front
// of the participle in the perfect tense.
const AUX_THIRD_PERSON: Record<string, string> = {
  hebben: "heeft",
  zijn: "is",
  "hebben/zijn": "heeft/is",
};

const LANGUAGE_FORMS: Record<string, LanguageForms> = {
  nl: {
    presentPronouns: ["ik", "jij", "hij", "wij"],
    verbKeys: ["pastSingular", "pastPlural", "participle", "auxiliary"],
    verbLines(details) {
      const lines: FormLine[] = [];
      const sg = str(details["pastSingular"]);
      const pl = str(details["pastPlural"]);
      if (sg || pl) {
        lines.push({ label: "past", value: sg && pl && sg !== pl ? `${sg}, ${pl}` : (sg ?? pl)! });
      }
      const participle = str(details["participle"]);
      if (participle) {
        const aux = AUX_THIRD_PERSON[str(details["auxiliary"]) ?? ""];
        lines.push({ label: "perfect", value: aux ? `${aux} ${participle}` : participle });
      }
      return lines;
    },
  },
  en: {
    presentPronouns: ["I", "you", "he", "we"],
    verbKeys: ["past", "participle"],
    verbLines(details) {
      const lines: FormLine[] = [];
      const past = str(details["past"]);
      if (past) lines.push({ label: "past", value: past });
      const participle = str(details["participle"]);
      if (participle) lines.push({ label: "participle", value: participle });
      return lines;
    },
  },
};

/** Pronoun order for the present-tense table of a language's verbs, if it has one. */
export const presentPronouns = (language: string): readonly string[] | undefined =>
  LANGUAGE_FORMS[language]?.presentPronouns;

/** The details keys a language's verbs should have. */
export const verbFormKeys = (language: string): readonly string[] => LANGUAGE_FORMS[language]?.verbKeys ?? [];

// The lines shown on the back of a card: the plural for nouns, and for verbs
// the present (when irregular), past and participle. Empty for entries with no
// forms.
export function formLines(language: string, details: Record<string, unknown>): FormLine[] {
  const lines: FormLine[] = [];

  const plural = str(details["plural"]);
  if (plural) lines.push({ label: "plural", value: plural });
  else if (details["uncountable"] === true) lines.push({ label: "plural", value: UNCOUNTABLE_NOTE });
  else if (details["pluralOnly"] === true) lines.push({ label: "plural", value: PLURAL_ONLY_NOTE });

  const present = details["present"];
  const pronouns = presentPronouns(language);
  if (present && typeof present === "object" && pronouns) {
    const map = present as Record<string, unknown>;
    const parts = pronouns.flatMap((p) => {
      const form = str(map[p]);
      return form ? [`${p} ${form}`] : [];
    });
    if (parts.length > 0) lines.push({ label: "present", value: parts.join(", ") });
  }

  lines.push(...(LANGUAGE_FORMS[language]?.verbLines(details) ?? []));
  return lines;
}

// Every form stored on a verb entry, for checking that a sentence uses one.
export function allVerbForms(language: string, details: Record<string, unknown>): string[] {
  const forms: string[] = [];
  for (const key of verbFormKeys(language)) {
    const v = str(details[key]);
    if (v && key !== "auxiliary") forms.push(v);
  }
  const present = details["present"];
  if (present && typeof present === "object") {
    for (const v of Object.values(present as Record<string, unknown>)) {
      const s = str(v);
      if (s) forms.push(s);
    }
  }
  return forms;
}
