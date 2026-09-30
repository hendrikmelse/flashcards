import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { authPlugin } from "./auth/plugin.js";
import type { Db } from "./db/types.js";
import { authRoutes } from "./routes/auth.js";
import { deckRoutes } from "./routes/deck.js";
import { healthRoutes } from "./routes/health.js";
import { packRoutes } from "./routes/packs.js";
import { studyRoutes } from "./routes/study.js";
import { createFsrsScheduler, type Scheduler } from "./srs/engine.js";

export async function buildApp({
  db,
  logger = true,
  scheduler = createFsrsScheduler(),
}: {
  db: Db;
  logger?: boolean;
  scheduler?: Scheduler;
}) {
  const app = Fastify({ logger });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(authPlugin, { db });
  await app.register(healthRoutes, { db });
  await app.register(authRoutes, { db });
  await app.register(packRoutes, { db });
  await app.register(deckRoutes, { db });
  await app.register(studyRoutes, { db, scheduler });
  return app;
}
