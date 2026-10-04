import { and, count, eq, sql } from "drizzle-orm";
import type { DirectionSummary, Scope, StatsResponse } from "@flashcards/shared";
import { userCards } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { inScope } from "./scope.js";

// What the deck holds, for a scope: a language pair, or with none, every deck. The directions the
// user has cards in, with how many, and when the next card comes due.
export async function getStats(
  db: Db,
  userId: string,
  now: Date,
  scope: Scope = {},
): Promise<StatsResponse> {
  const nowIso = now.toISOString();
  const mine = and(eq(userCards.userId, userId), inScope(userCards, scope));

  const directions: DirectionSummary[] = await db
    .select({
      fromLanguage: userCards.fromLanguage,
      toLanguage: userCards.toLanguage,
      total: count(),
    })
    .from(userCards)
    .where(mine)
    .groupBy(userCards.fromLanguage, userCards.toLanguage)
    .orderBy(userCards.fromLanguage, userCards.toLanguage);

  const [next] = await db
    .select({
      at: sql<string | null>`min(${userCards.dueAt}) filter (where ${userCards.state} <> 'new' and ${userCards.dueAt} > ${nowIso}::timestamptz)`,
    })
    .from(userCards)
    .where(mine);

  return {
    now: nowIso,
    nextDueAt: next?.at ? new Date(next.at).toISOString() : null,
    directions,
  };
}
