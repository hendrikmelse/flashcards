import { createHash, randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { emailTokens } from "../db/schema.js";
import type { Db } from "../db/types.js";

export type EmailTokenPurpose = (typeof emailTokens.$inferSelect)["purpose"];

const HOUR = 60 * 60 * 1000;
// A reset link gives access to the account, so it is short-lived; the others only confirm an address.
export const TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  reset_password: HOUR,
  verify_email: 72 * HOUR,
  change_email: 72 * HOUR,
};

/** The same person cannot be sent a new email of one kind more often than this. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Makes a one-time token for a user. Earlier unused tokens of the same kind stop working, so the
 * newest email is always the one that counts.
 */
export async function createEmailToken(
  db: Db,
  userId: string,
  purpose: EmailTokenPurpose,
  email: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.delete(emailTokens).where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose)));
    await tx.insert(emailTokens).values({
      id: hashToken(token),
      userId,
      purpose,
      email,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]),
    });
  });
  return token;
}

/** True when an email of this kind was already made for the user within the cooldown. */
export async function sentRecently(db: Db, userId: string, purpose: EmailTokenPurpose): Promise<boolean> {
  const rows = await db
    .select({ createdAt: emailTokens.createdAt })
    .from(emailTokens)
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose)));
  return rows.some((r) => Date.now() - r.createdAt.getTime() < RESEND_COOLDOWN_MS);
}

/**
 * Uses up a token: returns what it was for and deletes it, or null when it is unknown, of
 * another kind or expired. Deleting is one statement, so a token cannot be used twice even by
 * two requests at once.
 */
export async function consumeEmailToken(db: Db, token: string, purpose: EmailTokenPurpose) {
  const [row] = await db
    .delete(emailTokens)
    .where(and(eq(emailTokens.id, hashToken(token)), eq(emailTokens.purpose, purpose)))
    .returning();
  return row && row.expiresAt.getTime() > Date.now() ? row : null;
}

export async function deleteEmailTokens(db: Db, userId: string, purpose: EmailTokenPurpose) {
  await db.delete(emailTokens).where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose)));
}

// Expired tokens are already refused; this reclaims the rows.
export async function deleteExpiredEmailTokens(db: Db): Promise<number> {
  const rows = await db
    .delete(emailTokens)
    .where(lt(emailTokens.expiresAt, new Date()))
    .returning({ id: emailTokens.id });
  return rows.length;
}
