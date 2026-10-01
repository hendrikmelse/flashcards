import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPack, packFileSchema, type PackFile } from "./pack-file.js";

export interface LoadedPacks {
  packs: PackFile[];
  errors: string[];
  warnings: string[];
}

// Reads and validates every *.json file in a directory. Nothing here touches
// the database, so it also backs the offline `content:check` command.
export function loadPacks(dir: string): LoadedPacks {
  const result: LoadedPacks = { packs: [], errors: [], warnings: [] };
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) result.errors.push(`no .json files in ${dir}`);

  const seenSlugs = new Map<string, string>();
  const seenGlosses = new Map<string, string>();

  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      result.errors.push(`${file}: ${(e as Error).message}`);
      continue;
    }
    const parsed = packFileSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        result.errors.push(`${file}: ${issue.path.join(".")}: ${issue.message}`);
      }
      continue;
    }
    const pack = parsed.data;

    const slugFile = seenSlugs.get(pack.slug);
    if (slugFile) result.errors.push(`${file}: slug "${pack.slug}" is also used by ${slugFile}`);
    seenSlugs.set(pack.slug, file);

    // A gloss identifies a concept across the whole database, so two files
    // defining the same one would overwrite each other's entries.
    for (const concept of pack.concepts) {
      const glossFile = seenGlosses.get(concept.gloss);
      if (glossFile) result.errors.push(`${file}: gloss "${concept.gloss}" is also in ${glossFile}`);
      seenGlosses.set(concept.gloss, file);
    }

    const check = checkPack(pack);
    result.errors.push(...check.errors.map((m) => `${file}: ${m}`));
    result.warnings.push(...check.warnings.map((m) => `${file}: ${m}`));
    result.packs.push(pack);
  }
  return result;
}
