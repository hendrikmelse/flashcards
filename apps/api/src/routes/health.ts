import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { Db } from "../db/types.js";

export async function healthRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // Liveness: the process is up and serving. Deliberately does not touch the
  // database, so a DB outage doesn't get the container restarted for nothing.
  app.get("/health", async () => ({ status: "ok" }));

  // Readiness: can this instance actually serve requests (database reachable)?
  app.get("/ready", async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
}
