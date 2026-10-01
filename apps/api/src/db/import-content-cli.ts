import { loadPacks } from "../content/load.js";

// Validates the reviewed content files and, unless --check is given, imports
// them. Safe to run repeatedly and safe in production (it never touches user
// data). Run `seed-languages` first on a fresh database.
//
// CONTENT_DIR defaults to the repo's content/packs when run from apps/api.
const dir = process.env["CONTENT_DIR"] ?? "../../content/packs";
const checkOnly = process.argv.includes("--check");

const { packs, errors, warnings } = loadPacks(dir);
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`${errors.length} error(s); nothing was imported`);
  process.exit(1);
}

const total = packs.reduce((n, p) => n + p.concepts.length, 0);
console.log(`${packs.length} pack(s), ${total} concept(s), ${warnings.length} warning(s)`);

if (!checkOnly) {
  // Loaded late so --check works without a database or DATABASE_URL.
  const { db, sql } = await import("./client.js");
  const { importPack } = await import("../content/import.js");
  for (const pack of packs) {
    const s = await importPack(db, pack);
    console.log(
      `${s.slug}: ${s.concepts} concepts (${s.conceptsCreated} new), ${s.entries} entries, ${s.sentences} sentences`,
    );
  }
  await sql.end();
}
