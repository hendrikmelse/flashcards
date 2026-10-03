import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, count, desc, eq, exists, getTableColumns, inArray, lte, not, or, sql } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import {
  DECK_SORT_DEFAULT_ORDER,
  deckFilterSchema,
  pageQuerySchema,
  scopeQuerySchema,
  uuidParamSchema,
  type EntryView,
  type Scope,
} from "@flashcards/shared";
import { insertUserCards, loadEntries, loadSentences, sentenceKey } from "../content/queries.js";
import { entries, userCards } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { inScope } from "../study/scope.js";

const invalid = (reply: FastifyReply, issues: unknown) =>
  reply.code(400).send({ error: "Invalid input", issues });

const mirror = alias(userCards, "mirror");

// How a card is shown to the client, in the deck list and on its own.
function cardView(c: typeof userCards.$inferSelect & { mirrored: unknown }, entries: EntryView[]) {
  return {
    id: c.id,
    conceptId: c.conceptId,
    fromLanguage: c.fromLanguage,
    toLanguage: c.toLanguage,
    state: c.state,
    dueAt: c.dueAt,
    addedAt: c.addedAt,
    intervalDays: c.intervalDays,
    lapses: c.lapses,
    lastReviewedAt: c.lastReviewedAt,
    hasMirror: Boolean(c.mirrored),
    front: entries.filter((e) => e.language === c.fromLanguage),
    back: entries.filter((e) => e.language === c.toLanguage),
  };
}

export async function deckRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // SQL condition: the user also has this card's word in the opposite direction.
  const hasMirror = (userId: string) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(mirror)
        .where(
          and(
            eq(mirror.userId, userId),
            eq(mirror.conceptId, userCards.conceptId),
            eq(mirror.fromLanguage, userCards.toLanguage),
            eq(mirror.toLanguage, userCards.fromLanguage),
          ),
        ),
    );

  // The user's cards, narrowed by language pair or direction, stage and a search word.
  const cardFilter = (
    userId: string,
    scope: Scope,
    f: { state?: "new" | "learning" | "review"; q?: string },
  ) => {
    const like = f.q?.toLowerCase().replace(/[\\%_]/g, "\\$&");
    return and(
      eq(userCards.userId, userId),
      inScope(userCards, scope),
      f.state === "learning"
        ? inArray(userCards.state, ["learning", "relearning"])
        : f.state
          ? eq(userCards.state, f.state)
          : undefined,
      like
        ? exists(
            db
              .select({ one: sql`1` })
              .from(entries)
              .where(
                and(
                  eq(entries.conceptId, userCards.conceptId),
                  or(eq(entries.language, userCards.fromLanguage), eq(entries.language, userCards.toLanguage)),
                  sql`${entries.lemma} ilike ${"%" + like + "%"}`,
                ),
              ),
          )
        : undefined,
    );
  };

  // The user's active deck: progress summary plus a page of cards with their
  // entries resolved for each card's direction.
  app.get("/deck", { preHandler: app.requireAuth }, async (req, reply) => {
    const d = scopeQuerySchema.safeParse(req.query);
    const page = pageQuerySchema.safeParse(req.query);
    const f = deckFilterSchema.safeParse(req.query);
    if (!d.success) return invalid(reply, d.error.issues);
    if (!page.success) return invalid(reply, page.error.issues);
    if (!f.success) return invalid(reply, f.error.issues);

    const where = and(eq(userCards.userId, req.user!.id), inScope(userCards, d.data));

    const byState = await db
      .select({ state: userCards.state, n: count() })
      .from(userCards)
      .where(where)
      .groupBy(userCards.state);
    const [{ n: dueNow } = { n: 0 }] = await db
      .select({ n: count() })
      .from(userCards)
      .where(and(where, lte(userCards.dueAt, sql`now()`), sql`${userCards.state} <> 'new'`));

    const summary = { total: 0, new: 0, learning: 0, review: 0, relearning: 0, dueNow };
    for (const r of byState) {
      summary[r.state] = r.n;
      summary.total += r.n;
    }

    // The summary above covers the whole scope; the list is narrowed further.
    const userId = req.user!.id;
    const narrowed = cardFilter(userId, d.data, f.data);
    const listWhere =
      f.data.missingMirror === "1" ? and(narrowed, not(hasMirror(userId))) : narrowed;

    // Ordering. Ties always fall back to id so pages never overlap or skip.
    const dir = (f.data.order ?? DECK_SORT_DEFAULT_ORDER[f.data.sort]) === "desc" ? desc : asc;
    const stageRank = sql`(case ${userCards.state} when 'new' then 0 when 'learning' then 1 when 'relearning' then 2 else 3 end)`;
    const promptWord = sql`lower((select min(e.lemma) from entries e where e.concept_id = ${userCards.conceptId} and e.language = ${userCards.fromLanguage}))`;
    const orderBy = {
      added: [dir(userCards.addedAt)],
      // Cards not studied yet have no real due date, so they go last either way.
      due: [sql`(${userCards.state} = 'new')`, dir(userCards.dueAt)],
      status: [dir(stageRank), asc(userCards.dueAt)],
      alpha: [dir(promptWord)],
    }[f.data.sort];

    // One extra row tells us whether there is another page.
    const rows = await db
      .select({ ...getTableColumns(userCards), mirrored: hasMirror(userId) })
      .from(userCards)
      .where(listWhere)
      .orderBy(...orderBy, asc(userCards.id))
      .limit(page.data.limit + 1)
      .offset(page.data.offset);
    const hasMore = rows.length > page.data.limit;
    const cards = rows.slice(0, page.data.limit);

    const [{ n: mirrorable } = { n: 0 }] = await db
      .select({ n: count() })
      .from(userCards)
      .where(and(narrowed, not(hasMirror(userId))));

    const entryMap = await loadEntries(
      db,
      [...new Set(cards.map((c) => c.conceptId))],
      [...new Set(cards.flatMap((c) => [c.fromLanguage, c.toLanguage]))],
    );

    return {
      summary,
      hasMore,
      mirrorable,
      cards: cards.map((c) => cardView(c, entryMap.get(c.conceptId) ?? [])),
    };
  });

  // One of the user's cards in full, for looking at it outside a study session: both sides' words
  // (with their forms) and every example sentence.
  app.get("/deck/:id", { preHandler: app.requireAuth }, async (req, reply) => {
    const p = uuidParamSchema.safeParse(req.params);
    if (!p.success) return invalid(reply, p.error.issues);
    const userId = req.user!.id;

    const [row] = await db
      .select({ ...getTableColumns(userCards), mirrored: hasMirror(userId) })
      .from(userCards)
      .where(and(eq(userCards.id, p.data.id), eq(userCards.userId, userId)));
    if (!row) return reply.code(404).send({ error: "Card not found" });

    const languages = [row.fromLanguage, row.toLanguage];
    const entries = await loadEntries(db, [row.conceptId], languages);
    const sentences = await loadSentences(db, [row.conceptId], languages, 50);
    return {
      card: cardView(row, entries.get(row.conceptId) ?? []),
      sentences: {
        front: sentences.get(sentenceKey(row.conceptId, row.fromLanguage)) ?? [],
        back: sentences.get(sentenceKey(row.conceptId, row.toLanguage)) ?? [],
      },
    };
  });

  // Adds the opposite-direction card for every card in the user's deck that matches the
  // direction, stage and search and has none yet. New cards join the new-card queue, so
  // they are introduced a few at a time like any other cards.
  app.post("/deck/mirrors", { preHandler: app.requireAuth }, async (req, reply) => {
    const d = scopeQuerySchema.safeParse(req.body ?? {});
    const f = deckFilterSchema.pick({ q: true, state: true }).safeParse(req.body ?? {});
    if (!d.success) return invalid(reply, d.error.issues);
    if (!f.success) return invalid(reply, f.error.issues);
    const userId = req.user!.id;

    // The word must still have entries in both languages (it did when the card was added).
    const hasEntryIn = (language: PgColumn) =>
      exists(
        db
          .select({ one: sql`1` })
          .from(entries)
          .where(and(eq(entries.conceptId, userCards.conceptId), eq(entries.language, language))),
      );
    const sources = await db
      .select({
        conceptId: userCards.conceptId,
        fromLanguage: userCards.fromLanguage,
        toLanguage: userCards.toLanguage,
        sortKey: userCards.sortKey,
      })
      .from(userCards)
      .where(
        and(
          cardFilter(userId, d.data, f.data),
          not(hasMirror(userId)),
          hasEntryIn(userCards.fromLanguage),
          hasEntryIn(userCards.toLanguage),
        ),
      )
      .orderBy(asc(userCards.addedAt), asc(userCards.sortKey), asc(userCards.id));

    // One insert per mirrored direction, keeping the original order.
    const groups = new Map<string, { from: string; to: string; items: { conceptId: string; sortKey: number }[] }>();
    for (const c of sources) {
      const key = `${c.toLanguage}>${c.fromLanguage}`;
      const g = groups.get(key) ?? { from: c.toLanguage, to: c.fromLanguage, items: [] };
      g.items.push({ conceptId: c.conceptId, sortKey: c.sortKey });
      groups.set(key, g);
    }
    let added = 0;
    for (const g of groups.values()) added += await insertUserCards(db, userId, g.items, g.from, g.to);
    return { added };
  });
}
