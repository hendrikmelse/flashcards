import { asc, eq, inArray, isNull } from "drizzle-orm";
import { db, sql } from "./client.js";
import { cardReports, concepts, entries, reportComments, users } from "./schema.js";

// Reads what users have sent in (problems with words, bugs, feature suggestions) and answers it.
// The person who sent it sees the status and the conversation on their Your reports page.
//   npm run reports -w @flashcards/api                  open reports, oldest first
//   npm run reports -w @flashcards/api -- --all         resolved ones too
//   npm run reports -w @flashcards/api -- resolve <id>... [-m "reply"]
//                                                       mark reports (full ids or the first 8
//                                                       characters shown) as handled, optionally
//                                                       with a reply their authors can read
//   npm run reports -w @flashcards/api -- reply <id> "reply"
//                                                       write a reply without resolving
const rest = process.argv.slice(2);
const mFlag = rest.indexOf("-m");
const message = mFlag >= 0 ? rest[mFlag + 1]?.trim() : undefined;
const args = mFlag >= 0 ? rest.filter((_, i) => i !== mFlag && i !== mFlag + 1) : rest;

if (mFlag >= 0 && !message) {
  console.error("-m needs the reply text");
  process.exitCode = 1;
} else if (args[0] === "reply") {
  const [, prefix, ...text] = args;
  const body = text.join(" ").trim();
  if (!prefix || !body) {
    console.error("Usage: reports reply <id> \"reply\"");
    process.exitCode = 1;
  } else {
    const all = await db.select({ id: cardReports.id }).from(cardReports);
    const ids = all.filter((r) => r.id.startsWith(prefix)).map((r) => r.id);
    if (ids.length !== 1) {
      console.error(ids.length === 0 ? `No report starts with: ${prefix}` : `More than one report starts with: ${prefix}`);
      process.exitCode = 1;
    } else {
      await db.insert(reportComments).values({ reportId: ids[0]!, body, fromAdmin: true });
      console.log("Reply saved");
    }
  }
} else if (args[0] === "resolve") {
  const prefixes = args.slice(1);
  if (prefixes.length === 0) {
    console.error("Usage: reports resolve <id> [<id>...] [-m \"reply\"]");
    process.exitCode = 1;
  } else {
    const open = await db.select({ id: cardReports.id }).from(cardReports).where(isNull(cardReports.resolvedAt));
    const ids = prefixes.flatMap((p) => open.filter((r) => r.id.startsWith(p)).map((r) => r.id));
    const unknown = prefixes.filter((p) => !open.some((r) => r.id.startsWith(p)));
    if (ids.length > 0) {
      if (message) {
        await db.insert(reportComments).values(ids.map((reportId) => ({ reportId, body: message, fromAdmin: true })));
      }
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
      kind: cardReports.kind,
      title: cardReports.title,
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
    .leftJoin(concepts, eq(cardReports.conceptId, concepts.id))
    .leftJoin(users, eq(cardReports.userId, users.id))
    .where(args.includes("--all") ? undefined : isNull(cardReports.resolvedAt))
    .orderBy(asc(cardReports.createdAt));

  const words = await db
    .select({ conceptId: entries.conceptId, language: entries.language, lemma: entries.lemma })
    .from(entries)
    .where(inArray(entries.conceptId, rows.flatMap((r) => (r.conceptId ? [r.conceptId] : []))));

  const comments = rows.length
    ? await db
        .select()
        .from(reportComments)
        .where(inArray(reportComments.reportId, rows.map((r) => r.id)))
        .orderBy(asc(reportComments.createdAt))
    : [];

  for (const r of rows) {
    const lemmas = (lang: string | null) =>
      words.filter((w) => w.conceptId === r.conceptId && w.language === lang).map((w) => w.lemma).join(", ");
    // A word problem says what was wrong; a bug or suggestion says which it is.
    const what = r.kind === "card" ? r.reason : r.kind;
    console.log(
      `${r.id.slice(0, 8)}  ${r.createdAt.toISOString().slice(0, 16).replace("T", " ")}  ${what}${r.resolvedAt ? "  (resolved)" : ""}`,
    );
    const from = `from ${r.email ?? "a deleted account"}`;
    if (r.kind === "card") console.log(`  ${lemmas(r.from)} → ${lemmas(r.to)}   [${r.key}, ${r.from}→${r.to}]   ${from}`);
    else console.log(`  ${r.title}   ${from}`);
    if (r.note) console.log(`  “${r.note.replace(/\s+/g, " ")}”`);
    // The conversation, oldest first: what the sender added, and the replies sent back.
    for (const m of comments.filter((m) => m.reportId === r.id)) {
      const when = m.createdAt.toISOString().slice(0, 16).replace("T", " ");
      console.log(`  ${m.fromAdmin ? "reply" : "comment"} ${when}: ${m.body.replace(/\s+/g, " ")}`);
    }
  }
  console.log(`${rows.length} report${rows.length === 1 ? "" : "s"}`);
}

await sql.end();
