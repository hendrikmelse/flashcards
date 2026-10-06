import fp from "fastify-plugin";
import type { PublicUser } from "@flashcards/shared";
import type { Db } from "../db/types.js";
import { getSessionUser, SESSION_COOKIE } from "./sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    user: PublicUser | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Signed in, and an admin. A signed-in user who is not gets a 403. */
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// Loads the session user (if any) onto every request and exposes a
// `requireAuth` preHandler for protected routes.
export const authPlugin = fp<{ db: Db }>(async (app, { db }) => {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.user = await getSessionUser(db, token);
  });

  app.decorate("requireAuth", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Not authenticated" });
  });

  app.decorate("requireAdmin", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "Not authenticated" });
    if (req.user.role !== "admin") return reply.code(403).send({ error: "Admins only" });
  });
});
