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
