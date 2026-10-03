import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { reportCardSchema, uuidParamSchema } from "@flashcards/shared";
import { cardReports, concepts } from "../db/schema.js";
import type { Db } from "../db/types.js";

export async function reportRoutes(app: FastifyInstance, { db, rateLimitMax }: { db: Db; rateLimitMax: number }) {
  // Someone found a problem with a word. Anyone signed in may report any word (it is the content
  // that is wrong, not their card), so this does not check that the word is in their deck.
  app.post(
    "/concepts/:id/report",
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: rateLimitMax, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const p = uuidParamSchema.safeParse(req.params);
      const b = reportCardSchema.safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: "Invalid input", issues: p.error.issues });
      if (!b.success) return reply.code(400).send({ error: "Invalid input", issues: b.error.issues });

      const [concept] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, p.data.id));
      if (!concept) return reply.code(404).send({ error: "Word not found" });

      await db.insert(cardReports).values({ userId: req.user!.id, conceptId: concept.id, ...b.data });
      return reply.code(201).send({ ok: true });
    },
  );
}
