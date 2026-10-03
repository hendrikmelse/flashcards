import { asc, eq, inArray, isNull } from "drizzle-orm";
import { db, sql } from "./client.js";
import { cardReports, concepts, entries, users } from "./schema.js";

// Reads the problems users have reported with words.
//   npm run reports -w @flashcards/api                  open reports, oldest first
//   npm run reports -w @flashcards/api -- --all         resolved ones too
//   npm run reports -w @flashcards/api -- resolve <id>  mark reports (full ids or the first 8
//                                                       characters shown) as handled
const args = process.argv.slice(2);

if (args[0] === "resolve") {
  const prefixes = args.slice(1);
  if (prefixes.length === 0) {
    console.error("Usage: reports resolve <id> [<id>...]");
    process.exitCode = 1;
  } else {
    const open = await db.select({ id: cardReports.id }).from(cardReports).where(isNull(cardReports.resolvedAt));
    const ids = prefixes.flatMap((p) => open.filter((r) => r.id.startsWith(p)).map((r) => r.id));
    const unknown = prefixes.filter((p) => !open.some((r) => r.id.startsWith(p)));
    if (ids.length > 0) {
      await db.update(cardReports).set({ resolvedAt: new Date() }).where(inArray(cardReports.id, ids));
    }
    console.log(`Resolved ${ids.length} report${ids.length === 1 ? "" : "s"}`);
    if (unknown.length > 0) {
      console.error(`No open report starts with: ${unknown.join(", ")}`);
      process.exitCode = 1;
    }
  }
} else {
  const rows = await db
    .select({
      id: cardReports.id,
      conceptId: cardReports.conceptId,
      key: concepts.key,
      from: cardReports.fromLanguage,
      to: cardReports.toLanguage,
      reason: cardReports.reason,
      note: cardReports.note,
      createdAt: cardReports.createdAt,
      resolvedAt: cardReports.resolvedAt,
      email: users.email,
    })
    .from(cardReports)
    .innerJoin(concepts, eq(cardReports.conceptId, concepts.id))
    .leftJoin(users, eq(cardReports.userId, users.id))
    .where(args.includes("--all") ? undefined : isNull(cardReports.resolvedAt))
    .orderBy(asc(cardReports.createdAt));

  const words = await db
    .select({ conceptId: entries.conceptId, language: entries.language, lemma: entries.lemma })
    .from(entries)
    .where(inArray(entries.conceptId, rows.map((r) => r.conceptId)));

  for (const r of rows) {
    const lemmas = (lang: string) =>
      words.filter((w) => w.conceptId === r.conceptId && w.language === lang).map((w) => w.lemma).join(", ");
    console.log(
      `${r.id.slice(0, 8)}  ${r.createdAt.toISOString().slice(0, 16).replace("T", " ")}  ${r.reason}${r.resolvedAt ? "  (resolved)" : ""}`,
    );
    console.log(`  ${lemmas(r.from)} → ${lemmas(r.to)}   [${r.key}, ${r.from}→${r.to}]   from ${r.email ?? "a deleted account"}`);
    if (r.note) console.log(`  “${r.note.replace(/\s+/g, " ")}”`);
  }
  console.log(`${rows.length} report${rows.length === 1 ? "" : "s"}`);
}

await sql.end();
