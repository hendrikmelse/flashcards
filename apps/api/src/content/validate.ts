import { checkConcept, type Check, type Concept, type PackFile } from "./content-schema.js";

export interface ConceptSource {
  file: string;
  concepts: Concept[];
}
export interface PackSource {
  file: string;
  pack: PackFile;
}

// Checks that need the whole library at once: keys are unique across every
// concept file, and every pack refers only to concepts that exist. Pure, so it
// is tested without touching the filesystem.
export function validateContent(conceptFiles: ConceptSource[], packFiles: PackSource[]): Check {
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

      const check = checkConcept(concept);
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
