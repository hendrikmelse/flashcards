import { LANGUAGE_CODES, PACK_TEXT_LANGUAGE } from "@flashcards/shared";
import {
  checkConcept,
  checkEntries,
  type Check,
  type Concept,
  type LanguageFile,
  type PackFile,
} from "./content-schema.js";

export interface ConceptSource {
  file: string;
  concepts: Concept[];
}
export interface PackSource {
  file: string;
  pack: PackFile;
}
// A pack's name and description in a language other than PACK_TEXT_LANGUAGE.
export interface PackText {
  slug: string;
  language: string;
  name: string;
  description?: string | undefined;
}

// A file under languages/<folder>/: one language's entries for concepts defined elsewhere, and its
// texts for packs.
export interface LanguageSource {
  file: string;
  /** The folder it was found in, which must match the language it says it is for. */
  folder: string;
  content: LanguageFile;
}

// Checks that need the whole library at once: keys are unique across every
// concept file, every pack refers only to concepts that exist, and each language file adds
// entries only to concepts that exist and do not already have them. Pure, so it
// is tested without touching the filesystem. `languages` is the list of supported languages.
export function validateContent(
  conceptFiles: ConceptSource[],
  packFiles: PackSource[],
  languageFiles: LanguageSource[] = [],
  languages: readonly string[] = LANGUAGE_CODES,
): Check {
  const errors: string[] = [];
  const warnings: string[] = [];

  const keyFile = new Map<string, string>();
  const glossFile = new Map<string, string>();
  for (const { file, concepts } of conceptFiles) {
    for (const concept of concepts) {
      const keyIn = keyFile.get(concept.key);
      if (keyIn) errors.push(`${file}: key "${concept.key}" is also defined in ${keyIn}`);
      else keyFile.set(concept.key, file);

      // The gloss is only a curator's label, but two concepts with the same one
      // are usually a duplicate by mistake (or need clearer glosses).
      const glossIn = glossFile.get(concept.gloss);
      if (glossIn) {
        warnings.push(
          `${file}: "${concept.key}" has the same gloss as a concept in ${glossIn}: "${concept.gloss}"`,
        );
      } else glossFile.set(concept.gloss, file);

      const check = checkConcept(concept, languages);
      errors.push(...check.errors.map((m) => `${file}: ${m}`));
      warnings.push(...check.warnings.map((m) => `${file}: ${m}`));
    }
  }

  const packSlugs = new Set(packFiles.map((p) => p.pack.slug));
  const textIn = new Map<string, string>();

  // Each (concept, language) is defined in exactly one place: the concept file, or one language file.
  const definedIn = new Map<string, string>();
  for (const { file, concepts } of conceptFiles) {
    for (const concept of concepts) {
      for (const lang of Object.keys(concept.entries)) definedIn.set(`${concept.key}\u0000${lang}`, file);
    }
  }
  for (const { file, folder, content } of languageFiles) {
    const lang = content.language;
    if (lang !== folder) {
      errors.push(`${file}: says it is for "${lang}" but is in the folder for "${folder}"`);
      continue;
    }
    if (!languages.includes(lang)) {
      errors.push(`${file}: unknown language "${lang}" (known: ${languages.join(", ")})`);
      continue;
    }
    for (const text of content.packs) {
      if (lang === PACK_TEXT_LANGUAGE) {
        errors.push(`${file}: pack texts in ${lang} belong in the pack files, not a language file`);
        break;
      }
      if (!packSlugs.has(text.slug)) {
        errors.push(`${file}: unknown pack "${text.slug}"`);
        continue;
      }
      const slot = `${text.slug}\u0000${lang}`;
      const first = textIn.get(slot);
      if (first) errors.push(`${file}: pack "${text.slug}" already has ${lang} text in ${first}`);
      else textIn.set(slot, file);
    }

    for (const concept of content.concepts) {
      if (!keyFile.has(concept.key)) {
        errors.push(`${file}: unknown concept "${concept.key}" (add it to content/concepts first)`);
        continue;
      }
      const slot = `${concept.key}\u0000${lang}`;
      const first = definedIn.get(slot);
      if (first) {
        errors.push(`${file}: "${concept.key}" already has ${lang} entries in ${first}`);
        continue;
      }
      definedIn.set(slot, file);
      const check = { errors: [] as string[], warnings: [] as string[] };
      checkEntries(`"${concept.key}"`, lang, concept.entries, check.errors, check.warnings);
      errors.push(...check.errors.map((m) => `${file}: ${m}`));
      warnings.push(...check.warnings.map((m) => `${file}: ${m}`));
    }
  }

  const slugFile = new Map<string, string>();
  const inAPack = new Set<string>();
  for (const { file, pack } of packFiles) {
    const slugIn = slugFile.get(pack.slug);
    if (slugIn) errors.push(`${file}: slug "${pack.slug}" is also used by ${slugIn}`);
    else slugFile.set(pack.slug, file);

    const seen = new Set<string>();
    for (const key of pack.concepts) {
      if (seen.has(key)) errors.push(`${file}: "${key}" is listed twice`);
      seen.add(key);
      if (!keyFile.has(key)) errors.push(`${file}: unknown concept "${key}"`);
      inAPack.add(key);
    }
  }

  for (const [key, file] of keyFile) {
    if (!inAPack.has(key)) warnings.push(`${file}: "${key}" is not in any pack`);
  }
  return { errors, warnings };
}

// The names and descriptions of packs that the language files give in their languages.
export function collectPackTexts(languageFiles: LanguageSource[]): PackText[] {
  return languageFiles.flatMap(({ content }) =>
    content.packs.map((p) => ({ slug: p.slug, language: content.language, name: p.name, description: p.description })),
  );
}

// The concepts with the entries from the language files added to them, in the order of the concept
// files. Assumes `validateContent` found no problems: a language file's entries for a concept that
// is missing, or already has that language, are skipped.
export function mergeLanguageFiles(conceptFiles: ConceptSource[], languageFiles: LanguageSource[]): Concept[] {
  const added = new Map<string, Record<string, Concept["entries"][string]>>();
  for (const { content } of languageFiles) {
    for (const concept of content.concepts) {
      const forConcept = added.get(concept.key) ?? {};
      forConcept[content.language] ??= concept.entries;
      added.set(concept.key, forConcept);
    }
  }
  return conceptFiles.flatMap((f) =>
    f.concepts.map((c) => {
      const extra = added.get(c.key);
      if (!extra) return c;
      const entries = { ...c.entries };
      for (const [lang, list] of Object.entries(extra)) entries[lang] ??= list;
      return { ...c, entries };
    }),
  );
}
