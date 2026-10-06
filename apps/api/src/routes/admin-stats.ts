import type { FastifyInstance } from "fastify";
import { count, countDistinct, gte, isNull } from "drizzle-orm";
import type { AdminStats, ReportKind } from "@flashcards/shared";
import { cardReports, reviewLogs, users } from "../db/schema.js";
import type { Db } from "../db/types.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// The numbers at the top of the admin dashboard. An account is "active" when it has answered at
// least one card in the last 7 days. Reviews of accounts that have since been deleted are gone with
// them, so the all-time count is of the reviews still held.
export async function adminStatsRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get("/admin/stats", { preHandler: app.requireAdmin }, async (): Promise<AdminStats> => {
    const since = new Date(Date.now() - WEEK_MS);

    const [accounts] = await db.select({ n: count() }).from(users);
    const [active] = await db
      .select({ n: countDistinct(reviewLogs.userId) })
      .from(reviewLogs)
      .where(gte(reviewLogs.reviewedAt, since));
    const [reviews] = await db.select({ n: count() }).from(reviewLogs);
    const [recent] = await db.select({ n: count() }).from(reviewLogs).where(gte(reviewLogs.reviewedAt, since));

    const open = await db
      .select({ kind: cardReports.kind, n: count() })
      .from(cardReports)
      .where(isNull(cardReports.resolvedAt))
      .groupBy(cardReports.kind);
    const openByKind: Record<ReportKind, number> = { card: 0, bug: 0, suggestion: 0, pack_request: 0 };
    for (const row of open) openByKind[row.kind] = row.n;

    return {
      accounts: accounts?.n ?? 0,
      activeAccounts: active?.n ?? 0,
      reviews: { total: reviews?.n ?? 0, lastWeek: recent?.n ?? 0 },
      openReports: { total: Object.values(openByKind).reduce((sum, n) => sum + n, 0), byKind: openByKind },
    };
  });
}
