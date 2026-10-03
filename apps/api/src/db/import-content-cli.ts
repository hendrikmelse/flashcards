import { loadContent } from "../content/load.js";

// Validates the reviewed content files and, unless --check is given, imports
// them. Safe to run repeatedly and safe in production (it never touches user
// data). Run `seed-languages` first on a fresh database.
//
// CONTENT_DIR is the directory holding concepts/ and packs/; it defaults to the
// repo's content/ when run from apps/api.
const dir = process.env["CONTENT_DIR"] ?? "../../content";
const checkOnly = process.argv.includes("--check");

const { concepts, packs, packTexts, errors, warnings } = loadContent(dir);
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`${errors.length} error(s); nothing was imported`);
  process.exit(1);
}
console.log(`${concepts.length} concept(s), ${packs.length} pack(s), ${warnings.length} warning(s)`);

if (!checkOnly) {
  // Loaded late so --check works without a database or DATABASE_URL.
  const { db, sql } = await import("./client.js");
  const { importContent } = await import("../content/import.js");
  const s = await importContent(db, { concepts, packs, packTexts });
  console.log(
    `imported ${s.concepts} concepts (${s.conceptsCreated} new, ${s.conceptsAdopted} adopted), ` +
      `${s.entries} entries, ${s.sentences} sentences, ${s.packs} packs, ${s.packTexts} pack texts`,
  );
  if (s.conceptsNotInFiles.length > 0) {
    console.warn(
      `left alone, not in the files: ${s.conceptsNotInFiles.length} concept(s): ${s.conceptsNotInFiles.join(", ")}`,
    );
  }
  if (s.packsNotInFiles.length > 0) {
    console.warn(`left alone, not in the files: pack(s) ${s.packsNotInFiles.join(", ")}`);
  }
  await sql.end();
}
