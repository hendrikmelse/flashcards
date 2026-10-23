import { buildApp } from "./app.js";
import { deleteExpiredSessions } from "./auth/sessions.js";
import { deleteExpiredEmailTokens } from "./auth/email-tokens.js";
import { config } from "./config.js";
import { db, sql } from "./db/client.js";
import { mailSettingsFromEnv } from "./mail/config.js";
import { scheduleFeedbackDigest } from "./reports/digest.js";

const mail = mailSettingsFromEnv(process.env);
const app = await buildApp({
  db,
  prefix: "/api",
  trustProxy: config.TRUST_PROXY,
  production: config.NODE_ENV === "production",
  staticDir: config.WEB_DIST,
  mailer: mail.mailer,
  publicUrl: mail.publicUrl,
});

// Open reports are emailed once a day, not as they come in.
if (mail.reportNotifyEmail) {
  scheduleFeedbackDigest({ db, mailer: mail.mailer, to: mail.reportNotifyEmail, publicUrl: mail.publicUrl }, app.log);
}

async function cleanUp() {
  try {
    const removed = await deleteExpiredSessions(db);
    if (removed > 0) app.log.info({ removed }, "removed expired sessions");
    const tokens = await deleteExpiredEmailTokens(db);
    if (tokens > 0) app.log.info({ removed: tokens }, "removed expired email tokens");
  } catch (err) {
    app.log.error({ err }, "cleanup of expired sessions and email tokens failed");
  }
}
await cleanUp();
setInterval(cleanUp, 60 * 60 * 1000).unref();

// Finish in-flight requests and close the database pool when the platform
// stops the container (docker stop sends SIGTERM).
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}

await app.listen({ port: config.PORT, host: "0.0.0.0" });
