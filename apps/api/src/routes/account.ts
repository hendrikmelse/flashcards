import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import {
  changeEmailSchema,
  changePasswordSchema,
  deleteAccountSchema,
} from "@flashcards/shared";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { deleteOtherSessions, SESSION_COOKIE } from "../auth/sessions.js";
import { loadEntries } from "../content/queries.js";
import { concepts, reviewLogs, userCards, users } from "../db/schema.js";
import type { Db } from "../db/types.js";

const invalid = (reply: FastifyReply, issues: unknown) =>
  reply.code(400).send({ error: "Invalid input", issues });

// The database error (code 23505) may be wrapped by the query layer, so look through its causes.
const isUniqueViolation = (e: unknown): boolean => {
  if (typeof e !== "object" || e === null) return false;
  if ((e as { code?: unknown }).code === "23505") return true;
  return isUniqueViolation((e as { cause?: unknown }).cause);
};

// Rows are read in chunks so a large deck does not become one enormous query.
const CHUNK = 5000;

export async function accountRoutes(
  app: FastifyInstance,
  { db, rateLimitMax }: { db: Db; rateLimitMax: number },
) {
  // Routes that check a password are limited like login, so they cannot be used to guess one.
  const limit = { config: { rateLimit: { max: rateLimitMax, timeWindow: "1 minute" } } };

  async function passwordMatches(userId: string, password: string): Promise<boolean> {
    const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
    return !!u && (await verifyPassword(password, u.hash));
  }
  const wrongPassword = (reply: FastifyReply) =>
    reply.code(403).send({ error: "Incorrect password" });

  // Changes the password. Every other session is signed out, so a stolen session does not
  // survive the change; this one stays.
  app.post("/account/password", { ...limit, preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.issues);
    const userId = req.user!.id;
    if (!(await passwordMatches(userId, parsed.data.currentPassword))) return wrongPassword(reply);

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deleteOtherSessions(db, userId, token);
    return reply.code(204).send();
  });

  // Changes the email address. There is no verification step yet, so this only proves that
  // the person is signed in and knows the password.
  app.post("/account/email", { ...limit, preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = changeEmailSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.issues);
    const userId = req.user!.id;
    if (!(await passwordMatches(userId, parsed.data.password))) return wrongPassword(reply);

    try {
      const [user] = await db
        .update(users)
        .set({ email: parsed.data.email })
        .where(eq(users.id, userId))
        .returning({ id: users.id, email: users.email, name: users.name });
      return { user };
    } catch (e) {
      if (isUniqueViolation(e)) return reply.code(409).send({ error: "Email already registered" });
      throw e;
    }
  });

  // Deletes the account and everything that belongs to it (cards, review history, sessions).
  // The shared word content is not touched.
  app.post("/account/delete", { ...limit, preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = deleteAccountSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.issues);
    const userId = req.user!.id;
    if (!(await passwordMatches(userId, parsed.data.password))) return wrongPassword(reply);

    await db.delete(users).where(eq(users.id, userId)); // cascades to cards, reviews and sessions
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  // Everything the app holds about the user, as a JSON download: the account details (never the
  // password), every card with its schedule, and the full review history.
  app.get("/account/export", { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.user!.id;
    const [account] = await db
      .select({
        email: users.email,
        name: users.name,
        timezone: users.timezone,
        dailyNewCardLimit: users.dailyNewCardLimit,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId));

    const cardRows = await db
      .select({
        id: userCards.id,
        conceptId: userCards.conceptId,
        word: concepts.key,
        fromLanguage: userCards.fromLanguage,
        toLanguage: userCards.toLanguage,
        state: userCards.state,
        addedAt: userCards.addedAt,
        dueAt: userCards.dueAt,
        intervalDays: userCards.intervalDays,
        stability: userCards.stability,
        difficulty: userCards.difficulty,
        repetitions: userCards.repetitions,
        lapses: userCards.lapses,
        lastReviewedAt: userCards.lastReviewedAt,
      })
      .from(userCards)
      .innerJoin(concepts, eq(concepts.id, userCards.conceptId))
      .where(eq(userCards.userId, userId))
      .orderBy(asc(userCards.addedAt), asc(userCards.id));

    // The words themselves, so the export can be read without the app.
    const conceptIds = [...new Set(cardRows.map((c) => c.conceptId))];
    const entries = new Map<string, { language: string; lemma: string }[]>();
    for (let i = 0; i < conceptIds.length; i += CHUNK) {
      const chunk = await loadEntries(db, conceptIds.slice(i, i + CHUNK), []);
      for (const [id, es] of chunk) entries.set(id, es);
    }
    const lemmas = (conceptId: string, language: string) =>
      (entries.get(conceptId) ?? []).filter((e) => e.language === language).map((e) => e.lemma);

    const reviews = await db
      .select({
        word: concepts.key,
        fromLanguage: userCards.fromLanguage,
        toLanguage: userCards.toLanguage,
        rating: reviewLogs.rating,
        reviewedAt: reviewLogs.reviewedAt,
        timeTakenMs: reviewLogs.timeTakenMs,
        stateBefore: reviewLogs.stateBefore,
        stateAfter: reviewLogs.stateAfter,
        intervalBeforeDays: reviewLogs.intervalBeforeDays,
        intervalAfterDays: reviewLogs.intervalAfterDays,
        dueAfter: reviewLogs.dueAfter,
      })
      .from(reviewLogs)
      .innerJoin(userCards, eq(userCards.id, reviewLogs.userCardId))
      .innerJoin(concepts, eq(concepts.id, userCards.conceptId))
      .where(and(eq(reviewLogs.userId, userId)))
      .orderBy(asc(reviewLogs.reviewedAt), asc(reviewLogs.id));

    const exportedAt = new Date();
    reply
      .header("content-type", "application/json; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="flashcards-export-${exportedAt.toISOString().slice(0, 10)}.json"`,
      )
      .header("cache-control", "no-store");
    return {
      exportedAt,
      account,
      cards: cardRows.map(({ id: _id, conceptId, ...card }) => ({
        ...card,
        prompt: lemmas(conceptId, card.fromLanguage),
        answer: lemmas(conceptId, card.toLanguage),
      })),
      reviews,
    };
  });
}
