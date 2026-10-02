import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, count, desc, eq, exists, inArray, lte, or, sql } from "drizzle-orm";
import {
  DECK_SORT_DEFAULT_ORDER,
  deckFilterSchema,
  directionQuerySchema,
  pageQuerySchema,
} from "@flashcards/shared";
import { loadEntries } from "../content/queries.js";
import { entries, userCards } from "../db/schema.js";
import type { Db } from "../db/types.js";

const invalid = (reply: FastifyReply, issues: unknown) =>
  reply.code(400).send({ error: "Invalid input", issues });

export async function deckRoutes(app: FastifyInstance, { db }: { db: Db }) {
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
    const like = f.data.q?.toLowerCase().replace(/[\\%_]/g, "\\$&");
    const listWhere = and(
      where,
      f.data.state === "learning"
        ? inArray(userCards.state, ["learning", "relearning"])
        : f.data.state
          ? eq(userCards.state, f.data.state)
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
      .select()
      .from(userCards)
      .where(listWhere)
      .orderBy(...orderBy, asc(userCards.id))
      .limit(page.data.limit + 1)
      .offset(page.data.offset);
    const hasMore = rows.length > page.data.limit;
    const cards = rows.slice(0, page.data.limit);

    const entryMap = await loadEntries(
      db,
      [...new Set(cards.map((c) => c.conceptId))],
      [...new Set(cards.flatMap((c) => [c.fromLanguage, c.toLanguage]))],
    );

    return {
      summary,
      hasMore,
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
          front: es.filter((e) => e.language === c.fromLanguage),
          back: es.filter((e) => e.language === c.toLanguage),
        };
      }),
    };
  });
}
