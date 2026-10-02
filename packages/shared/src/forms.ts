// Word forms live in an entry's `details` (jsonb, so key order is NOT kept):
//
//   nouns (both languages): { plural }, { uncountable: true } or { pluralOnly: true }
//   nl: { pastSingular, pastPlural, participle, auxiliary, present? }
//       auxiliary is "hebben", "zijn" or "hebben/zijn"
//   en: { past, participle, present? }
//
// `present` is only stored for verbs whose present tense is irregular, as a
// map from pronoun to form. `defective: true` marks verbs that lack some forms
// (English "can", "must") and so are exempt from the completeness check.

// Pronoun order for the present-tense table, since stored keys have no order.
export const PRESENT_PRONOUNS: Record<string, readonly string[]> = {
  nl: ["ik", "jij", "hij", "wij"],
  en: ["I", "you", "he", "we"],
};

export const DUTCH_AUXILIARIES = ["hebben", "zijn", "hebben/zijn"] as const;

export const FORM_KEYS: Record<string, readonly string[]> = {
  nl: ["pastSingular", "pastPlural", "participle", "auxiliary"],
  en: ["past", "participle"],
};

export type FormLine = { label: string; value: string };

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : undefined;

// "hebben" -> "heeft", "zijn" -> "is": the third-person form that goes in front
// of the participle in the perfect tense.
const AUX_THIRD_PERSON: Record<string, string> = {
  hebben: "heeft",
  zijn: "is",
  "hebben/zijn": "heeft/is",
};

// The lines shown on the back of a card: the plural for nouns, and for verbs
// the present (when irregular), past and participle. Empty for entries with no
// forms.
export function formLines(language: string, details: Record<string, unknown>): FormLine[] {
  const lines: FormLine[] = [];

  const plural = str(details["plural"]);
  if (plural) lines.push({ label: "plural", value: plural });
  else if (details["uncountable"] === true) lines.push({ label: "plural", value: "uncountable" });
  else if (details["pluralOnly"] === true) lines.push({ label: "plural", value: "plural only" });

  const present = details["present"];
  const pronouns = PRESENT_PRONOUNS[language];
  if (present && typeof present === "object" && pronouns) {
    const map = present as Record<string, unknown>;
    const parts = pronouns.flatMap((p) => {
      const form = str(map[p]);
      return form ? [`${p} ${form}`] : [];
    });
    if (parts.length > 0) lines.push({ label: "present", value: parts.join(", ") });
  }

  if (language === "nl") {
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
  } else {
    const past = str(details["past"]);
    if (past) lines.push({ label: "past", value: past });
    const participle = str(details["participle"]);
    if (participle) lines.push({ label: "participle", value: participle });
  }
  return lines;
}

// Every form stored on a verb entry, for checking that a sentence uses one.
export function allVerbForms(language: string, details: Record<string, unknown>): string[] {
  const forms: string[] = [];
  for (const key of FORM_KEYS[language] ?? []) {
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
