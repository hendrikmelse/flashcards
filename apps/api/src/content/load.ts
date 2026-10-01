import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { conceptFileSchema, packFileSchema, type Concept, type PackFile } from "./content-schema.js";
import { validateContent, type ConceptSource, type PackSource } from "./validate.js";

export interface LoadedContent {
  concepts: Concept[];
  packs: PackFile[];
  errors: string[];
  warnings: string[];
}

// Reads concepts/*.json and packs/*.json under `dir` and validates them as one
// library. Nothing here touches the database, so it also backs the offline
// `content:check` command.
export function loadContent(dir: string): LoadedContent {
  const errors: string[] = [];
  const conceptFiles: ConceptSource[] = [];
  const packFiles: PackSource[] = [];

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

  // Cross-file checks would only add noise (unknown concepts) if a file failed to parse.
  const cross =
    errors.length === 0 ? validateContent(conceptFiles, packFiles) : { errors: [], warnings: [] };
  return {
    concepts: conceptFiles.flatMap((f) => f.concepts),
    packs: packFiles.map((f) => f.pack),
    errors: [...errors, ...cross.errors],
    warnings: cross.warnings,
  };
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
