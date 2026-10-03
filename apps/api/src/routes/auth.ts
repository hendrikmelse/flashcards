import type { FastifyInstance, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { isValidTimeZone, loginSchema, registerSchema } from "@flashcards/shared";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../auth/password.js";
import { mayRegister, type RegistrationPolicy } from "../auth/registration.js";
import {
  createSession,
  deleteSession,
  SESSION_COOKIE,
} from "../auth/sessions.js";
import { users } from "../db/schema.js";
import type { Db } from "../db/types.js";

const invalid = (reply: FastifyReply, issues: unknown) =>
  reply.code(400).send({ error: "Invalid input", issues });

export async function authRoutes(
  app: FastifyInstance,
  { db, registration }: { db: Db; registration: RegistrationPolicy },
) {
  const secure = process.env.NODE_ENV === "production";

  async function startSession(reply: FastifyReply, userId: string) {
    const { token, expiresAt } = await createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      expires: expiresAt,
    });
  }

  const limit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.post("/auth/register", limit, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.issues);
    const { email, password, timezone, name } = parsed.data;
    if (!mayRegister(registration, email)) {
      return reply.code(403).send({ error: "Registration is closed" });
    }

    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(users)
      .values({
        email,
        name: name || null,
        passwordHash,
        // Without a (valid) time zone from the browser the account stays on the default.
        ...(timezone && isValidTimeZone(timezone) ? { timezone } : {}),
      })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id, email: users.email, name: users.name });
    if (!user) return reply.code(409).send({ error: "Email already registered" });

    await startSession(reply, user.id);
    return reply.code(201).send({ user });
  });

  app.post("/auth/login", limit, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.issues);
    const { email, password } = parsed.data;

    const [user] = await db.select().from(users).where(eq(users.email, email));
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    await startSession(reply, user.id);
    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  // "Who am I?" for the page load. Answers 200 for everyone, with user: null
  // when logged out, so an anonymous visitor does not produce a failed request
  // (and a console error) just by opening the site. Never cacheable: the answer
  // depends on the session cookie.
  app.get("/auth/me", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return { user: req.user };
  });
}
