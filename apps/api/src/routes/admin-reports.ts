import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { addCommentSchema, updateReportSchema, uuidParamSchema, type AdminReport } from "@flashcards/shared";
import { cardReports, reportComments, users } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { reportViews } from "./reports.js";

// Everyone's reports, for admins: to read them, talk to the sender, and close them without the
// command line.
export async function adminReportRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get("/admin/reports", { preHandler: app.requireAdmin }, async (): Promise<{ reports: AdminReport[] }> => {
    const rows = await db
      .select({ report: cardReports, email: users.email, name: users.name, role: users.role })
      .from(cardReports)
      .leftJoin(users, eq(cardReports.userId, users.id))
      .orderBy(desc(cardReports.createdAt), desc(cardReports.id));
    const views = await reportViews(db, rows.map((r) => r.report));
    return {
      reports: views.map((v, i) => {
        const r = rows[i]!;
        // A report outlives its sender's account, which leaves no user to show.
        return { ...v, reporter: r.email ? { email: r.email, name: r.name, role: r.role! } : null };
      }),
    };
  });

  // An admin's reply: a message in the conversation, which the sender sees on their reports page.
  app.post("/admin/reports/:id/comments", { preHandler: app.requireAdmin }, async (req, reply) => {
    const p = uuidParamSchema.safeParse(req.params);
    const b = addCommentSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Invalid input", issues: p.error.issues });
    if (!b.success) return reply.code(400).send({ error: "Invalid input", issues: b.error.issues });

    const [report] = await db.select({ id: cardReports.id }).from(cardReports).where(eq(cardReports.id, p.data.id));
    if (!report) return reply.code(404).send({ error: "Report not found" });

    await db.insert(reportComments).values({ reportId: report.id, body: b.data.body, fromAdmin: true });
    return reply.code(201).send({ ok: true });
  });

  // Resolve or reopen a report. A report is resolved only after it has been answered.
  app.patch("/admin/reports/:id", { preHandler: app.requireAdmin }, async (req, reply) => {
    const p = uuidParamSchema.safeParse(req.params);
    const b = updateReportSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Invalid input", issues: p.error.issues });
    if (!b.success) return reply.code(400).send({ error: "Invalid input", issues: b.error.issues });

    const [report] = await db.select().from(cardReports).where(eq(cardReports.id, p.data.id));
    if (!report) return reply.code(404).send({ error: "Report not found" });

    if (b.data.resolved) {
      const [answered] = await db
        .select({ id: reportComments.id })
        .from(reportComments)
        .where(and(eq(reportComments.reportId, report.id), eq(reportComments.fromAdmin, true)))
        .limit(1);
      if (!answered) return reply.code(409).send({ error: "Reply to the report before resolving it" });
    }

    await db
      .update(cardReports)
      // Resolving an already resolved report keeps the date it was first resolved.
      .set({ resolvedAt: b.data.resolved ? (report.resolvedAt ?? new Date()) : null })
      .where(eq(cardReports.id, report.id));
    return { ok: true };
  });
}
