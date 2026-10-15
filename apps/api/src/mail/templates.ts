import type { Email } from "./mailer.js";

const APP = "Language Flashcards";

const footer = (reason: string) => `\n\n${reason}\n\n${APP}`;

export const verifyEmailMessage = (to: string, link: string): Email => ({
  to,
  subject: `Confirm your email for ${APP}`,
  text:
    `Welcome! Confirm that this is your email address by opening this link:\n\n${link}\n\n` +
    `The link works for 3 days.` +
    footer("If you did not sign up, you can ignore this email."),
});

export const changeEmailMessage = (to: string, link: string): Email => ({
  to,
  subject: `Confirm your new email for ${APP}`,
  text:
    `Someone asked to use this address for a ${APP} account. ` +
    `To confirm the change, open this link:\n\n${link}\n\nThe link works for 3 days.` +
    footer("If this was not you, ignore this email and nothing will change."),
});

export const resetPasswordMessage = (to: string, link: string): Email => ({
  to,
  subject: `Reset your ${APP} password`,
  text:
    `To choose a new password, open this link:\n\n${link}\n\n` +
    `The link works for one hour and only once. Resetting your password signs you out everywhere.` +
    footer("If you did not ask for this, ignore this email. Your password has not changed."),
});

export interface DigestReport {
  id: string;
  kind: "card" | "bug" | "suggestion" | "pack_request";
  /** What it is about: "huis → house, home" for a word, the title for the others. */
  subject: string;
  /** For a word: what was wrong. */
  problem?: string | undefined;
  note: string;
  /** The sender's email, or null once they have deleted their account. */
  reporter: string | null;
  createdAt: Date;
  comments: { fromAdmin: boolean; body: string }[];
}

const DIGEST_SECTIONS = [
  ["card", "Problems with words"],
  ["bug", "Bugs"],
  ["suggestion", "Feature suggestions"],
  ["pack_request", "Pack requests"],
] as const;

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const daysOld = (since: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000));

/** Tells the owner, once a day, everything that is still open: what came in and what waits for a reply. */
export const openFeedbackDigestMessage = (
  to: string,
  { reports, publicUrl, now }: { reports: DigestReport[]; publicUrl: string; now: Date },
): Email => {
  // Waiting for the owner: nothing said back yet, or the sender had the last word.
  const waiting = (r: DigestReport) => !r.comments.at(-1)?.fromAdmin;
  const unanswered = reports.filter(waiting).length;

  const sections = DIGEST_SECTIONS.flatMap(([kind, heading]) => {
    const items = reports.filter((r) => r.kind === kind).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (items.length === 0) return [];
    const lines = items.map((r) => {
      const age = daysOld(r.createdAt, now);
      const meta = [
        r.id.slice(0, 8),
        age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"} old`,
        `from ${r.reporter ?? "a deleted account"}`,
        waiting(r) ? "needs a reply" : "replied",
      ].join(", ");
      const latest = r.comments.filter((c) => !c.fromAdmin).at(-1);
      return [
        `- ${r.subject}${r.problem ? ` (${r.problem})` : ""}`,
        `  ${meta}`,
        ...(r.note ? [`  “${oneLine(r.note, 300)}”`] : []),
        ...(latest ? [`  Latest comment: “${oneLine(latest.body, 200)}”`] : []),
      ].join("\n");
    });
    return [`${heading} (${items.length})\n\n${lines.join("\n\n")}`];
  });

  const count = (n: number) => `${n} open report${n === 1 ? "" : "s"}`;
  return {
    to,
    subject: `Open feedback: ${count(reports.length)}${unanswered > 0 ? `, ${unanswered} to answer` : ""}`,
    text:
      `${count(reports.length)}, ${unanswered} waiting for your reply.\n\n` +
      sections.join("\n\n") +
      `\n\nAnswer them in the Admin dashboard at ${publicUrl}/admin, or with the reports script ` +
      `(deploy/README.md, "Reading problem reports").` +
      footer("You get this email every morning at 7am Los Angeles time while any feedback is open, because REPORT_NOTIFY_EMAIL is set."),
  };
};
