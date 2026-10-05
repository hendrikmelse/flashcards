import type { Db } from "../db/types.js";
import type { Mailer } from "../mail/mailer.js";
import { changeEmailMessage, resetPasswordMessage, verifyEmailMessage } from "../mail/templates.js";
import { createEmailToken } from "./email-tokens.js";

export interface MailDeps {
  db: Db;
  mailer: Mailer;
  publicUrl: string;
}

const link = ({ publicUrl }: MailDeps, path: string, token: string) =>
  `${publicUrl}/${path}?token=${encodeURIComponent(token)}`;

export async function sendVerificationEmail(deps: MailDeps, user: { id: string; email: string }) {
  const token = await createEmailToken(deps.db, user.id, "verify_email", user.email);
  await deps.mailer.send(verifyEmailMessage(user.email, link(deps, "verify-email", token)));
}

/** Sent to the new address; the account's address only changes when its link is opened. */
export async function sendChangeEmailEmail(deps: MailDeps, userId: string, newEmail: string) {
  const token = await createEmailToken(deps.db, userId, "change_email", newEmail);
  await deps.mailer.send(changeEmailMessage(newEmail, link(deps, "verify-email", token)));
}

export async function sendPasswordResetEmail(deps: MailDeps, user: { id: string; email: string }) {
  const token = await createEmailToken(deps.db, user.id, "reset_password", user.email);
  await deps.mailer.send(resetPasswordMessage(user.email, link(deps, "reset-password", token)));
}
