import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { authPlugin } from "./auth/plugin.js";
import { OPEN_REGISTRATION, type RegistrationPolicy } from "./auth/registration.js";
import type { Db } from "./db/types.js";
import { authRoutes } from "./routes/auth.js";
import { deckRoutes } from "./routes/deck.js";
import { healthRoutes } from "./routes/health.js";
import { packRoutes } from "./routes/packs.js";
import { statsRoutes } from "./routes/stats.js";
import { studyRoutes } from "./routes/study.js";
import { helmetOptions, originCheck } from "./security.js";
import { createFsrsScheduler, type Scheduler } from "./srs/engine.js";

export interface AppOptions {
  db: Db;
  logger?: boolean;
  scheduler?: Scheduler;
  /** URL prefix for all API routes, e.g. "/api". */
  prefix?: string;
  /** Trust X-Forwarded-* from a reverse proxy in front of the app. */
  trustProxy?: boolean;
  production?: boolean;
  /** Directory of the built web app to serve alongside the API. */
  staticDir?: string;
  /** Who may create an account. Defaults to open. */
  registration?: RegistrationPolicy;
}

export async function buildApp({
  db,
  logger = true,
  scheduler = createFsrsScheduler(),
  prefix = "",
  trustProxy = false,
  production = false,
  staticDir,
  registration = OPEN_REGISTRATION,
}: AppOptions) {
  const app = Fastify({ logger, trustProxy });

  await app.register(helmet, helmetOptions(production));
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(authPlugin, { db });
  app.addHook("onRequest", originCheck);

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { db });
      await api.register(authRoutes, { db, registration });
      await api.register(packRoutes, { db });
      await api.register(deckRoutes, { db });
      await api.register(studyRoutes, { db, scheduler });
      await api.register(statsRoutes, { db });
    },
    { prefix },
  );

  if (staticDir) {
    await app.register(fastifyStatic, {
      root: staticDir,
      // Hashed build assets never change; everything else (index.html) must be
      // revalidated so a deploy is picked up immediately.
      setHeaders(res, filePath) {
        res.header(
          "cache-control",
          /[\\/]assets[\\/]/.test(filePath)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    });

    // Client-side routes (/packs, /study, ...) are served the app shell. API
    // paths and requests for missing files (*.js, *.png, ...) stay real 404s.
    app.setNotFoundHandler((req, reply) => {
      const path = (req.raw.url ?? "").split("?")[0]!;
      const isApi = prefix !== "" && (path === prefix || path.startsWith(`${prefix}/`));
      const looksLikeFile = /\.[a-z0-9]+$/i.test(path);
      if (req.method === "GET" && !isApi && !looksLikeFile) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Not found" });
    });
  }

  return app;
}
