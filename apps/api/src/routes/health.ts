import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { Db } from "../db/types.js";

export async function healthRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get("/health", async () => {
    await db.execute(sql`select 1`);
    return { status: "ok" };
  });
}
