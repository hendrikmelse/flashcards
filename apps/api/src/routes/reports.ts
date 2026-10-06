import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  REPORT_REASON_LABELS,
  addCommentSchema,
  reportCardSchema,
  submitFeedbackSchema,
  uuidParamSchema,
  type EntryView,
  type MyReport,
  type ReportComment,
} from "@flashcards/shared";
import { loadEntries } from "../content/queries.js";
import { cardReports, concepts, reportComments } from "../db/schema.js";
import type { Db } from "../db/types.js";
import type { Email, Mailer } from "../mail/mailer.js";
import { newReportMessage, reportCommentMessage } from "../mail/templates.js";

/** Who to tell when a report comes in, and how. Without it, reports are only stored. */
export interface ReportNotifier {
  mailer: Mailer;
  /** The owner's address. */
  to: string;
  publicUrl: string;
}

// The word as the card showed it: "huis" or "house, home", for each side.
const words = (entries: EntryView[], language: string) =>
  entries
    .filter((e) => e.language === language)
    .map((e) => e.lemma)
    .join(", ");

export async function reportRoutes(
  app: FastifyInstance,
  { db, rateLimitMax, notify }: { db: Db; rateLimitMax: number; notify?: ReportNotifier | undefined },
) {
  // Telling the owner is best effort: the report is saved either way, and a slow or failing email
  // provider must not make the reporter wait or think it did not go through.
  function sendToOwner(req: FastifyRequest, reportId: string, build: (to: string, reporter: string, publicUrl: string) => Email) {
    if (!notify) return;
    try {
      void notify.mailer
        .send(build(notify.to, req.user!.email, notify.publicUrl))
        .catch((err: unknown) => req.log.error({ err, reportId }, "could not email the report"));
    } catch (err) {
      req.log.error({ err, reportId }, "could not email the report");
    }
  }
  function tellOwner(req: FastifyRequest, r: Omit<Parameters<typeof newReportMessage>[1], "reporter" | "publicUrl">) {
    sendToOwner(req, r.id, (to, reporter, publicUrl) => newReportMessage(to, { ...r, reporter, publicUrl }));
  }

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

      const [report] = await db
        .insert(cardReports)
        .values({ userId: req.user!.id, conceptId: concept.id, ...b.data })
        .returning({ id: cardReports.id });

      if (report) {
        const entries = (await loadEntries(db, [concept.id], [b.data.fromLanguage, b.data.toLanguage]).catch(() => null))?.get(concept.id) ?? [];
        tellOwner(req, {
          id: report.id,
          kind: "card",
          subject: `${words(entries, b.data.fromLanguage)} → ${words(entries, b.data.toLanguage)}`,
          problem: REPORT_REASON_LABELS[b.data.reason],
          direction: `${b.data.fromLanguage}→${b.data.toLanguage}`,
          note: b.data.note,
        });
      }

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

      const [report] = await db
        .insert(cardReports)
        .values({ userId: req.user!.id, ...b.data })
        .returning({ id: cardReports.id });
      if (report) tellOwner(req, { id: report.id, kind: b.data.kind, subject: b.data.title, note: b.data.note });
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

      let subject = report.title;
      if (report.kind === "card" && report.conceptId && report.fromLanguage && report.toLanguage) {
        const es = (await loadEntries(db, [report.conceptId], [report.fromLanguage, report.toLanguage]).catch(() => null))?.get(report.conceptId) ?? [];
        subject = `${words(es, report.fromLanguage)} → ${words(es, report.toLanguage)}`;
      }
      sendToOwner(req, report.id, (to, reporter, publicUrl) =>
        reportCommentMessage(to, { id: report.id, subject, body: b.data.body, reporter, publicUrl }),
      );
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
