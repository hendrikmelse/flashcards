import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  addCommentSchema,
  reportCardSchema,
  submitFeedbackSchema,
  uuidParamSchema,
  type MyReport,
  type ReportComment,
} from "@flashcards/shared";
import { loadEntries } from "../content/queries.js";
import { cardReports, concepts, reportComments } from "../db/schema.js";
import type { Db } from "../db/types.js";

export async function reportRoutes(app: FastifyInstance, { db, rateLimitMax }: { db: Db; rateLimitMax: number }) {
  // Someone found a problem with a word. Anyone signed in may report any word (it is the content
  // that is wrong, not their card), so this does not check that the word is in their deck.
  app.post(
    "/concepts/:id/report",
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: rateLimitMax, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const p = uuidParamSchema.safeParse(req.params);
      const b = reportCardSchema.safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: "Invalid input", issues: p.error.issues });
      if (!b.success) return reply.code(400).send({ error: "Invalid input", issues: b.error.issues });

      const [concept] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, p.data.id));
      if (!concept) return reply.code(404).send({ error: "Word not found" });

      await db.insert(cardReports).values({ userId: req.user!.id, conceptId: concept.id, ...b.data });

      return reply.code(201).send({ ok: true });
    },
  );

  // A bug or a feature suggestion: not about a word, so anyone signed in may send one anywhere.
  app.post(
    "/reports",
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: rateLimitMax, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const b = submitFeedbackSchema.safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: "Invalid input", issues: b.error.issues });

      await db.insert(cardReports).values({ userId: req.user!.id, ...b.data });
      return reply.code(201).send({ ok: true });
    },
  );

  // The author adds to a report of theirs that is still open: more details, an answer to a question.
  // Once it is resolved the conversation is over, and a new report is the way to raise it again.
  app.post(
    "/reports/:id/comments",
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: rateLimitMax, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const p = uuidParamSchema.safeParse(req.params);
      const b = addCommentSchema.safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: "Invalid input", issues: p.error.issues });
      if (!b.success) return reply.code(400).send({ error: "Invalid input", issues: b.error.issues });

      // Someone else's report is as good as no report.
      const [report] = await db
        .select()
        .from(cardReports)
        .where(and(eq(cardReports.id, p.data.id), eq(cardReports.userId, req.user!.id)));
      if (!report) return reply.code(404).send({ error: "Report not found" });
      if (report.resolvedAt) return reply.code(409).send({ error: "This report is resolved" });

      await db.insert(reportComments).values({ reportId: report.id, body: b.data.body });
      return reply.code(201).send({ ok: true });
    },
  );

  // The reports the signed-in user has made, newest first, with where each one stands.
  app.get("/reports", { preHandler: app.requireAuth }, async (req): Promise<{ reports: MyReport[] }> => {
    const rows = await db
      .select()
      .from(cardReports)
      .where(eq(cardReports.userId, req.user!.id))
      .orderBy(desc(cardReports.createdAt), desc(cardReports.id));
    return { reports: await reportViews(db, rows) };
  });
}

/**
 * Reports as the app shows them: the word on each side of a word problem, the sender's comments,
 * and the status. Shared by the sender's own list and the admin's list of everyone's.
 */
export async function reportViews(db: Db, rows: (typeof cardReports.$inferSelect)[]): Promise<MyReport[]> {
  const languages = [...new Set(rows.flatMap((r) => [r.fromLanguage, r.toLanguage]).filter((l) => l !== null))];
  const entries = await loadEntries(db, [...new Set(rows.map((r) => r.conceptId).filter((c) => c !== null))], languages);

  const commentRows = rows.length
    ? await db
        .select()
        .from(reportComments)
        .where(inArray(reportComments.reportId, rows.map((r) => r.id)))
        .orderBy(asc(reportComments.createdAt), asc(reportComments.id))
    : [];
  const comments = new Map<string, ReportComment[]>();
  for (const c of commentRows) {
    const list = comments.get(c.reportId) ?? [];
    list.push({ id: c.id, body: c.body, fromAdmin: c.fromAdmin, createdAt: c.createdAt.toISOString() });
    comments.set(c.reportId, list);
  }

  return rows.map((r) => {
    const es = (r.conceptId && entries.get(r.conceptId)) || [];
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      conceptId: r.conceptId,
      front: es.filter((e) => e.language === r.fromLanguage),
      back: es.filter((e) => e.language === r.toLanguage),
      fromLanguage: r.fromLanguage,
      toLanguage: r.toLanguage,
      reason: r.reason,
      note: r.note,
      status: r.resolvedAt ? "resolved" : "open",
      comments: comments.get(r.id) ?? [],
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    };
  });
}
