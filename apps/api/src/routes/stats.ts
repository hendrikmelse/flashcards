import type { FastifyInstance } from "fastify";
import { pairQuerySchema } from "@flashcards/shared";
import type { Db } from "../db/types.js";
import { getStats } from "../study/stats.js";

export async function statsRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // Dashboard extras: reviews today, when the next card is due and a per-direction breakdown of
  // the deck, for one language pair (`pair=en-nl`) or, without one, every deck.
  app.get("/stats", { preHandler: app.requireAuth }, async (req, reply) => {
    const scope = pairQuerySchema.safeParse(req.query);
    if (!scope.success) return reply.code(400).send({ error: "Invalid input", issues: scope.error.issues });
    return getStats(db, req.user!.id, new Date(), scope.data);
  });
}
