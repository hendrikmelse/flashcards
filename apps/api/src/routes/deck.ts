import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, count, desc, eq, lte, sql } from "drizzle-orm";
import { directionQuerySchema, pageQuerySchema } from "@flashcards/shared";
import { loadEntries } from "../content/queries.js";
import { userCards } from "../db/schema.js";
import type { Db } from "../db/types.js";

const invalid = (reply: FastifyReply, issues: unknown) =>
  reply.code(400).send({ error: "Invalid input", issues });

export async function deckRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // The user's active deck: progress summary plus a page of cards with their
  // entries resolved for each card's direction.
  app.get("/deck", { preHandler: app.requireAuth }, async (req, reply) => {
    const d = directionQuerySchema.safeParse(req.query);
    const page = pageQuerySchema.safeParse(req.query);
    if (!d.success) return invalid(reply, d.error.issues);
    if (!page.success) return invalid(reply, page.error.issues);
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

    const cards = await db
      .select()
      .from(userCards)
      .where(where)
      .orderBy(desc(userCards.addedAt), asc(userCards.id))
      .limit(page.data.limit)
      .offset(page.data.offset);

    const entryMap = await loadEntries(
      db,
      [...new Set(cards.map((c) => c.conceptId))],
      [...new Set(cards.flatMap((c) => [c.fromLanguage, c.toLanguage]))],
    );

    return {
      summary,
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
          front: es.filter((e) => e.language === c.fromLanguage),
          back: es.filter((e) => e.language === c.toLanguage),
        };
      }),
    };
  });
}
