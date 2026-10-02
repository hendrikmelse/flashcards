import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, count, desc, eq, exists, getTableColumns, inArray, lte, not, or, sql } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import {
  DECK_SORT_DEFAULT_ORDER,
  deckFilterSchema,
  directionQuerySchema,
  pageQuerySchema,
} from "@flashcards/shared";
import { insertUserCards, loadEntries } from "../content/queries.js";
import { entries, userCards } from "../db/schema.js";
import type { Db } from "../db/types.js";

const invalid = (reply: FastifyReply, issues: unknown) =>
  reply.code(400).send({ error: "Invalid input", issues });

const mirror = alias(userCards, "mirror");

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

  // The user's cards, narrowed by direction, stage and a search word.
  const cardFilter = (
    userId: string,
    direction: { fromLanguage?: string; toLanguage?: string },
    f: { state?: "new" | "learning" | "review"; q?: string },
  ) => {
    const like = f.q?.toLowerCase().replace(/[\\%_]/g, "\\$&");
    return and(
      eq(userCards.userId, userId),
      direction.fromLanguage ? eq(userCards.fromLanguage, direction.fromLanguage) : undefined,
      direction.toLanguage ? eq(userCards.toLanguage, direction.toLanguage) : undefined,
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
    const d = directionQuerySchema.safeParse(req.query);
    const page = pageQuerySchema.safeParse(req.query);
    const f = deckFilterSchema.safeParse(req.query);
    if (!d.success) return invalid(reply, d.error.issues);
    if (!page.success) return invalid(reply, page.error.issues);
    if (!f.success) return invalid(reply, f.error.issues);
    const { fromLanguage, toLanguage } = d.data;

    const where = and(
      eq(userCards.userId, req.user!.id),
      fromLanguage ? eq(userCards.fromLanguage, fromLanguage) : undefined,
      toLanguage ? eq(userCards.toLanguage, toLanguage) : undefined,
    );

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

    // The summary above covers the whole direction; the list is narrowed further.
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
      interval: [dir(userCards.intervalDays), asc(userCards.dueAt)],
      lapses: [dir(userCards.lapses), asc(userCards.dueAt)],
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
      cards: cards.map((c) => {
        const es = entryMap.get(c.conceptId) ?? [];
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
          hasMirror: c.mirrored,
          front: es.filter((e) => e.language === c.fromLanguage),
          back: es.filter((e) => e.language === c.toLanguage),
        };
      }),
    };
  });

  // Adds the opposite-direction card for every card in the user's deck that matches the
  // direction, stage and search and has none yet. New cards join the new-card queue, so
  // they are introduced a few at a time like any other cards.
  app.post("/deck/mirrors", { preHandler: app.requireAuth }, async (req, reply) => {
    const d = directionQuerySchema.safeParse(req.body ?? {});
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
