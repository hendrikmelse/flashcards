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

/** Tells the owner a report came in: a word problem, a bug, or a feature suggestion. */
export const newReportMessage = (
  to: string,
  r: {
    id: string;
    kind: "card" | "bug" | "suggestion" | "pack_request";
    /** What it is about: "huis → house, home" for a word, the title for a bug or suggestion. */
    subject: string;
    /** For a word: what was wrong, and the direction. */
    problem?: string;
    direction?: string;
    note: string;
    reporter: string;
    publicUrl: string;
  },
): Email => {
  const what = {
    card: "a problem with a word",
    bug: "a bug",
    suggestion: "a feature suggestion",
    pack_request: "a pack they would like",
  }[r.kind];
  const label = {
    card: "Problem report",
    bug: "Bug report",
    suggestion: "Feature suggestion",
    pack_request: "Pack request",
  }[r.kind];
  const id = r.id.slice(0, 8);
  return {
    to,
    subject: `${label}: ${r.subject}`,
    text:
      `${r.reporter} reported ${what}.\n\n` +
      (r.kind === "card" ? `Word: ${r.subject} (${r.direction})\nProblem: ${r.problem}\n` : `Title: ${r.subject}\n`) +
      (r.note ? `Details: ${r.note}\n` : "") +
      `Report: ${id}\n\n` +
      `Read open reports with the reports script (deploy/README.md, "Reading problem reports"), then ` +
      `answer with: reports.js resolve ${id} -m "your reply". The reporter sees the reply at ` +
      `${r.publicUrl}/reports.` +
      footer("You get this email for every report because REPORT_NOTIFY_EMAIL is set."),
  };
};

/** Tells the owner that someone added a comment to a report that is still open. */
export const reportCommentMessage = (
  to: string,
  r: { id: string; subject: string; body: string; reporter: string; publicUrl: string },
): Email => ({
  to,
  subject: `New comment on report: ${r.subject}`,
  text:
    `${r.reporter} added a comment to an open report (${r.id.slice(0, 8)}, ${r.subject}):\n\n${r.body}\n\n` +
    `Read it with the reports script (deploy/README.md, "Reading problem reports"), then answer with: ` +
    `reports.js reply ${r.id.slice(0, 8)} "your reply". The reporter sees the reply at ${r.publicUrl}/reports.` +
    footer("You get this email for every comment because REPORT_NOTIFY_EMAIL is set."),
});
