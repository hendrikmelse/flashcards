import type { FastifyInstance } from "fastify";
import type { Db } from "../db/types.js";
import { getStats } from "../study/stats.js";

export async function statsRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // Dashboard extras: reviews today, when the next card is due
  // and a per-direction breakdown of the deck.
  app.get("/stats", { preHandler: app.requireAuth }, async (req) =>
    getStats(db, req.user!.id, new Date()),
  );
}
