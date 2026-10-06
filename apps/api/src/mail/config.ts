import { z } from "zod";
import { createConsoleMailer, createResendMailer, type Mailer } from "./mailer.js";

export interface MailSettings {
  mailer: Mailer;
  /** Where the app is reached from outside; the links in emails start with it. */
  publicUrl: string;
  /** Who is emailed about each problem report; none when unset. */
  reportNotifyEmail: string | undefined;
}

// The Vite dev server's default address, which proxies /api to the API.
const DEV_URL = "http://localhost:5173";

/**
 * Production must be able to send real email, so it refuses to start without the settings
 * (like REGISTRATION_MODE). Development prints emails to the console instead.
 */
export function mailSettingsFromEnv(env: NodeJS.ProcessEnv): MailSettings {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim();
  const publicUrl = env.PUBLIC_URL?.trim().replace(/\/+$/, "");
  const reportNotifyEmail = env.REPORT_NOTIFY_EMAIL?.trim() || undefined;

  if (env.NODE_ENV === "production") {
    const missing = [
      ["RESEND_API_KEY", apiKey],
      ["MAIL_FROM", from],
      ["PUBLIC_URL", publicUrl],
    ].filter(([, v]) => !v);
    if (missing.length > 0) {
      throw new Error(`${missing.map(([k]) => k).join(", ")} must be set in production`);
    }
  }
  if (publicUrl && !/^https?:\/\/[^/\s]+$/.test(publicUrl)) {
    throw new Error(`PUBLIC_URL must be an address like https://example.com (got "${publicUrl}")`);
  }

  if (reportNotifyEmail && !z.string().email().safeParse(reportNotifyEmail).success) {
    throw new Error(`REPORT_NOTIFY_EMAIL must be an email address (got "${reportNotifyEmail}")`);
  }

  return {
    mailer: apiKey && from ? createResendMailer({ apiKey, from }) : createConsoleMailer(),
    publicUrl: publicUrl || DEV_URL,
    reportNotifyEmail,
  };
}
