import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  conceptFileSchema,
  languageFileSchema,
  packFileSchema,
  type Concept,
  type PackFile,
} from "./content-schema.js";
import {
  mergeLanguageFiles,
  validateContent,
  type ConceptSource,
  type LanguageSource,
  type PackSource,
} from "./validate.js";

export interface LoadedContent {
  concepts: Concept[];
  packs: PackFile[];
  errors: string[];
  warnings: string[];
}

// Reads concepts/*.json, packs/*.json and (optionally) languages/<code>/*.json under `dir` and
// validates them as one library. The returned concepts already have each language file's entries
// added to them. Nothing here touches the database, so it also backs the offline `content:check`
// command.
export function loadContent(dir: string, languages?: readonly string[]): LoadedContent {
  const errors: string[] = [];
  const conceptFiles: ConceptSource[] = [];
  const packFiles: PackSource[] = [];
  const languageFiles: LanguageSource[] = [];

  for (const file of jsonFiles(join(dir, "concepts"), errors)) {
    const raw = readJson(file.path, file.name, errors);
    if (raw === undefined) continue;
    const parsed = conceptFileSchema.safeParse(raw);
    if (!parsed.success) addIssues(file.name, parsed.error.issues, errors);
    else conceptFiles.push({ file: file.name, concepts: parsed.data.concepts });
  }
  for (const file of jsonFiles(join(dir, "packs"), errors)) {
    const raw = readJson(file.path, file.name, errors);
    if (raw === undefined) continue;
    const parsed = packFileSchema.safeParse(raw);
    if (!parsed.success) addIssues(file.name, parsed.error.issues, errors);
    else packFiles.push({ file: file.name, pack: parsed.data });
  }

  // Language files are optional: a folder for each language, none until there is a language
  // beyond the ones in the concept files.
  for (const folder of subfolders(join(dir, "languages"))) {
    for (const file of jsonFiles(join(dir, "languages", folder), errors)) {
      const name = `languages/${folder}/${file.name.split("/").pop()}`;
      const raw = readJson(file.path, name, errors);
      if (raw === undefined) continue;
      const parsed = languageFileSchema.safeParse(raw);
      if (!parsed.success) addIssues(name, parsed.error.issues, errors);
      else languageFiles.push({ file: name, folder, content: parsed.data });
    }
  }

  // Cross-file checks would only add noise (unknown concepts) if a file failed to parse.
  const cross =
    errors.length === 0
      ? validateContent(conceptFiles, packFiles, languageFiles, languages)
      : { errors: [], warnings: [] };
  return {
    concepts: mergeLanguageFiles(conceptFiles, languageFiles),
    packs: packFiles.map((f) => f.pack),
    errors: [...errors, ...cross.errors],
    warnings: cross.warnings,
  };
}

function subfolders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function jsonFiles(dir: string, errors: string[]): { name: string; path: string }[] {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch (e) {
    errors.push(`cannot read ${dir}: ${(e as Error).message}`);
    return [];
  }
  if (names.length === 0) errors.push(`no .json files in ${dir}`);
  return names.map((name) => ({ name: `${basename(dir)}/${name}`, path: join(dir, name) }));
}

function readJson(path: string, name: string, errors: string[]): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    errors.push(`${name}: ${(e as Error).message}`);
    return undefined;
  }
}

function addIssues(
  name: string,
  issues: { path: PropertyKey[]; message: string }[],
  errors: string[],
) {
  for (const issue of issues) {
    errors.push(`${name}: ${issue.path.map(String).join(".")}: ${issue.message}`);
  }
}
