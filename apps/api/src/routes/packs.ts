import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, count, eq, exists, inArray, not, sql } from "drizzle-orm";
import {
  addToDeckSchema,
  conceptSearchQuerySchema,
  directionQuerySchema,
  pageQuerySchema,
  uuidParamSchema,
  type PackCategory,
} from "@flashcards/shared";
import {
  availableInDirection,
  insertUserCards,
  loadEntries,
} from "../content/queries.js";
import {
  concepts,
  entries,
  languages,
  packConcepts,
  packs,
  userCards,
} from "../db/schema.js";
import type { Db } from "../db/types.js";

const invalid = (reply: FastifyReply, issues: unknown) =>
  reply.code(400).send({ error: "Invalid input", issues });

export async function packRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get("/languages", async () => ({
    languages: await db.select().from(languages).orderBy(asc(languages.code)),
  }));

  // Public. With a direction, also reports how many concepts can actually
  // become cards in it and, for a logged-in user, how many they already have.
  app.get("/packs", async (req, reply) => {
    const q = directionQuerySchema.safeParse(req.query);
    if (!q.success) return invalid(reply, q.error.issues);
    const { fromLanguage, toLanguage } = q.data;

    const rows = await db
      .select({
        id: packs.id,
        slug: packs.slug,
        name: packs.name,
        description: packs.description,
        category: packs.category,
        conceptCount: count(packConcepts.conceptId),
      })
      .from(packs)
      .leftJoin(packConcepts, eq(packConcepts.packId, packs.id))
      .groupBy(packs.id)
      .orderBy(asc(packs.name));

    if (!fromLanguage || !toLanguage) return { packs: rows };

    const ids = rows.map((r) => r.id);
    const available = new Map<string, number>();
    const added = new Map<string, number>();
    if (ids.length > 0) {
      const availRows = await db
        .select({ packId: packConcepts.packId, n: count() })
        .from(packConcepts)
        .where(
          and(
            inArray(packConcepts.packId, ids),
            availableInDirection(db, packConcepts.conceptId, fromLanguage, toLanguage),
          ),
        )
        .groupBy(packConcepts.packId);
      for (const r of availRows) available.set(r.packId, r.n);

      if (req.user) {
        const addedRows = await db
          .select({ packId: packConcepts.packId, n: count() })
          .from(packConcepts)
          .innerJoin(userCards, eq(userCards.conceptId, packConcepts.conceptId))
          .where(
            and(
              inArray(packConcepts.packId, ids),
              eq(userCards.userId, req.user.id),
              eq(userCards.fromLanguage, fromLanguage),
              eq(userCards.toLanguage, toLanguage),
            ),
          )
          .groupBy(packConcepts.packId);
        for (const r of addedRows) added.set(r.packId, r.n);
      }
    }

    return {
      packs: rows.map((r) => ({
        ...r,
        category: r.category as PackCategory,
        availableCount: available.get(r.id) ?? 0,
        ...(req.user ? { addedCount: added.get(r.id) ?? 0 } : {}),
      })),
    };
  });

  // Public. Concepts in pack order with their entries. With a direction, only
  // the two languages' entries are returned, plus `available` and (for a
  // logged-in user) `inDeck` flags.
  app.get("/packs/:id", async (req, reply) => {
    const p = uuidParamSchema.safeParse(req.params);
    const d = directionQuerySchema.safeParse(req.query);
    const page = pageQuerySchema.safeParse(req.query);
    if (!p.success) return invalid(reply, p.error.issues);
    if (!d.success) return invalid(reply, d.error.issues);
    if (!page.success) return invalid(reply, page.error.issues);
    const { fromLanguage, toLanguage } = d.data;

    const [pack] = await db.select().from(packs).where(eq(packs.id, p.data.id));
    if (!pack) return reply.code(404).send({ error: "Pack not found" });

    const members = await db
      .select({ conceptId: packConcepts.conceptId, position: packConcepts.position })
      .from(packConcepts)
      .where(eq(packConcepts.packId, pack.id))
      .orderBy(asc(packConcepts.position), asc(packConcepts.conceptId))
      .limit(page.data.limit)
      .offset(page.data.offset);

    const conceptIds = members.map((m) => m.conceptId);
    const direction = fromLanguage && toLanguage;
    const entryMap = await loadEntries(
      db,
      conceptIds,
      direction ? [fromLanguage, toLanguage] : [],
    );

    const inDeck = new Set<string>();
    if (direction && req.user && conceptIds.length > 0) {
      const rows = await db
        .select({ conceptId: userCards.conceptId })
        .from(userCards)
        .where(
          and(
            eq(userCards.userId, req.user.id),
            eq(userCards.fromLanguage, fromLanguage),
            eq(userCards.toLanguage, toLanguage),
            inArray(userCards.conceptId, conceptIds),
          ),
        );
      for (const r of rows) inDeck.add(r.conceptId);
    }

    return {
      pack: { id: pack.id, slug: pack.slug, name: pack.name, description: pack.description },
      concepts: members.map((m) => {
        const es = entryMap.get(m.conceptId) ?? [];
        return {
          conceptId: m.conceptId,
          position: m.position,
          entries: es,
          ...(direction
            ? {
                available:
                  es.some((e) => e.language === fromLanguage) &&
                  es.some((e) => e.language === toLanguage),
                ...(req.user ? { inDeck: inDeck.has(m.conceptId) } : {}),
              }
            : {}),
        };
      }),
    };
  });

  // Adds every concept in the pack that is available in the direction and not
  // already in the user's deck.
  app.post("/packs/:id/add", { preHandler: app.requireAuth }, async (req, reply) => {
    const p = uuidParamSchema.safeParse(req.params);
    const b = addToDeckSchema.safeParse(req.body);
    if (!p.success) return invalid(reply, p.error.issues);
    if (!b.success) return invalid(reply, b.error.issues);
    const { fromLanguage, toLanguage } = b.data;

    const [pack] = await db.select().from(packs).where(eq(packs.id, p.data.id));
    if (!pack) return reply.code(404).send({ error: "Pack not found" });

    const [{ n: total } = { n: 0 }] = await db
      .select({ n: count() })
      .from(packConcepts)
      .where(eq(packConcepts.packId, pack.id));

    const available = await db
      .select({ conceptId: packConcepts.conceptId, position: packConcepts.position })
      .from(packConcepts)
      .where(
        and(
          eq(packConcepts.packId, pack.id),
          availableInDirection(db, packConcepts.conceptId, fromLanguage, toLanguage),
        ),
      )
      .orderBy(asc(packConcepts.position));

    const added = await insertUserCards(
      db,
      req.user!.id,
      available.map((a) => ({ conceptId: a.conceptId, sortKey: a.position })),
      fromLanguage,
      toLanguage,
    );

    return {
      added,
      alreadyInDeck: available.length - added,
      unavailable: total - available.length,
    };
  });

  // Public. Finds words by lemma in either language of the direction, best
  // matches first (exact, then prefix, then anywhere in the word). Only concepts
  // that can become a card in the direction are returned.
  app.get("/concepts/search", async (req, reply) => {
    const q = conceptSearchQuerySchema.safeParse(req.query);
    if (!q.success) return invalid(reply, q.error.issues);
    const { fromLanguage, toLanguage, limit, offset } = q.data;
    const term = q.data.q.toLowerCase();
    const like = term.replace(/[\\%_]/g, "\\$&");

    const rank = sql<number>`min(case
      when lower(${entries.lemma}) = ${term} then 0
      when lower(${entries.lemma}) like ${like + "%"} then 1
      else 2 end)`;
    const matches = await db
      .select({ conceptId: entries.conceptId })
      .from(entries)
      // Joined so the availability check below has an outer table to correlate with;
      // it cannot use `entries`, which its own subquery also reads from.
      .innerJoin(concepts, eq(concepts.id, entries.conceptId))
      .where(
        and(
          inArray(entries.language, [fromLanguage, toLanguage]),
          sql`${entries.lemma} ilike ${"%" + like + "%"}`,
          availableInDirection(db, concepts.id, fromLanguage, toLanguage),
          q.data.hideInDeck === "1" && req.user
            ? not(
                exists(
                  db
                    .select({ one: sql`1` })
                    .from(userCards)
                    .where(
                      and(
                        eq(userCards.userId, req.user.id),
                        eq(userCards.conceptId, entries.conceptId),
                        eq(userCards.fromLanguage, fromLanguage),
                        eq(userCards.toLanguage, toLanguage),
                      ),
                    ),
                ),
              )
            : undefined,
        ),
      )
      .groupBy(entries.conceptId)
      .orderBy(
        rank,
        sql`min(length(${entries.lemma}))`,
        sql`min(${entries.lemma})`,
        entries.conceptId,
      )
      .limit(limit + 1)
      .offset(offset);

    // One extra row tells us whether there is another page.
    const hasMore = matches.length > limit;
    const conceptIds = matches.slice(0, limit).map((m) => m.conceptId);
    const entryMap = await loadEntries(db, conceptIds, [fromLanguage, toLanguage]);

    const inDeck = new Set<string>();
    if (req.user && conceptIds.length > 0) {
      const rows = await db
        .select({ conceptId: userCards.conceptId })
        .from(userCards)
        .where(
          and(
            eq(userCards.userId, req.user.id),
            eq(userCards.fromLanguage, fromLanguage),
            eq(userCards.toLanguage, toLanguage),
            inArray(userCards.conceptId, conceptIds),
          ),
        );
      for (const r of rows) inDeck.add(r.conceptId);
    }

    return {
      concepts: conceptIds.map((id) => ({
        conceptId: id,
        entries: entryMap.get(id) ?? [],
        ...(req.user ? { inDeck: inDeck.has(id) } : {}),
      })),
      hasMore,
    };
  });

  app.post("/concepts/:id/add", { preHandler: app.requireAuth }, async (req, reply) => {
    const p = uuidParamSchema.safeParse(req.params);
    const b = addToDeckSchema.safeParse(req.body);
    if (!p.success) return invalid(reply, p.error.issues);
    if (!b.success) return invalid(reply, b.error.issues);
    const { fromLanguage, toLanguage } = b.data;

    const [concept] = await db
      .select({ id: concepts.id })
      .from(concepts)
      .where(
        and(
          eq(concepts.id, p.data.id),
          availableInDirection(db, concepts.id, fromLanguage, toLanguage),
        ),
      );
    if (!concept) {
      const [exists] = await db
        .select({ id: concepts.id })
        .from(concepts)
        .where(eq(concepts.id, p.data.id));
      return exists
        ? reply.code(422).send({ error: "Concept has no entries in both languages" })
        : reply.code(404).send({ error: "Concept not found" });
    }

    const added = await insertUserCards(
      db,
      req.user!.id,
      [{ conceptId: concept.id, sortKey: 0 }],
      fromLanguage,
      toLanguage,
    );
    return reply.code(added ? 201 : 200).send({ added, alreadyInDeck: 1 - added });
  });
}
