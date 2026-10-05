import { publicUserColumns, toPublicUser } from "../auth/public-user.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import {
  forgotPasswordSchema,
  isValidTimeZone,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "@flashcards/shared";
import { sendPasswordResetEmail, sendVerificationEmail, type MailDeps } from "../auth/email-flows.js";
import { consumeEmailToken, deleteEmailTokens, sentRecently } from "../auth/email-tokens.js";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../auth/password.js";
import { mayRegister, type RegistrationPolicy } from "../auth/registration.js";
import {
  createSession,
  deleteAllSessions,
  deleteSession,
  SESSION_COOKIE,
} from "../auth/sessions.js";
import { isUniqueViolation } from "../db/errors.js";
import { users } from "../db/schema.js";
import type { Db } from "../db/types.js";

const invalid = (reply: FastifyReply, issues: unknown) =>
  reply.code(400).send({ error: "Invalid input", issues });

export async function authRoutes(
  app: FastifyInstance,
  {
    db,
    registration,
    rateLimitMax,
    mail,
  }: { db: Db; registration: RegistrationPolicy; rateLimitMax: number; mail: MailDeps },
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

  const limit = { config: { rateLimit: { max: rateLimitMax, timeWindow: "1 minute" } } };

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
      .returning(publicUserColumns);
    if (!user) return reply.code(409).send({ error: "Email already registered" });

    // Not awaited: signing up must not depend on the mail provider being up. The account page
    // offers to send it again.
    sendVerificationEmail(mail, user).catch((err) =>
      req.log.error({ err }, "could not send the verification email"),
    );

    await startSession(reply, user.id);
    return reply.code(201).send({ user: toPublicUser(user) });
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
    return { user: toPublicUser(user) };
  });

  // Always answers 204, whether or not the address has an account, so it cannot be used to find
  // out who is registered. The email goes out in the background for the same reason: sending
  // takes longer than not sending.
  app.post("/auth/forgot-password", limit, async (req, reply) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.issues);

    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, parsed.data.email));
    if (user && !(await sentRecently(db, user.id, "reset_password"))) {
      sendPasswordResetEmail(mail, user).catch((err) =>
        req.log.error({ err }, "could not send the password reset email"),
      );
    }
    return reply.code(204).send();
  });

  // Sets a new password from the link in the email. The link works once. Every session is
  // signed out, so whoever had access with the old password loses it, and the person logs in
  // again with the new one.
  app.post("/auth/reset-password", limit, async (req, reply) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.issues);

    const bad = () => reply.code(400).send({ error: "This link is invalid or has expired" });
    const token = await consumeEmailToken(db, parsed.data.token, "reset_password");
    if (!token) return bad();
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, token.userId));
    // The address changed after the email was sent, so the link no longer belongs to this account.
    if (!user || user.email !== token.email) return bad();

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await db.update(users).set({ passwordHash }).where(eq(users.id, token.userId));
    // Receiving the link proves the person controls the address.
    await db
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(and(eq(users.id, token.userId), isNull(users.emailVerifiedAt)));
    await deleteAllSessions(db, token.userId);
    return reply.code(204).send();
  });

  // Opens the link from a verification email, or from the one sent to a new address. Needs no
  // login: the link is opened from the mailbox, often on another device.
  app.post("/auth/verify-email", limit, async (req, reply) => {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.issues);
    const bad = () => reply.code(400).send({ error: "This link is invalid or has expired" });

    const verify = await consumeEmailToken(db, parsed.data.token, "verify_email");
    if (verify) {
      const [user] = await db
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(and(eq(users.id, verify.userId), eq(users.email, verify.email)))
        .returning({ id: users.id });
      return user ? { status: "verified" } : bad();
    }

    const change = await consumeEmailToken(db, parsed.data.token, "change_email");
    if (!change) return bad();
    try {
      await db
        .update(users)
        .set({ email: change.email, emailVerifiedAt: new Date() })
        .where(eq(users.id, change.userId));
    } catch (e) {
      if (isUniqueViolation(e)) {
        return reply.code(409).send({ error: "That email is already registered" });
      }
      throw e;
    }
    // A verification or reset link sent to the old address no longer applies.
    await deleteEmailTokens(db, change.userId, "verify_email");
    await deleteEmailTokens(db, change.userId, "reset_password");
    return { status: "changed" };
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
