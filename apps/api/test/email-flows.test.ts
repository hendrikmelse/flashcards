import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { RESEND_COOLDOWN_MS, TOKEN_TTL_MS } from "../src/auth/email-tokens.js";
import * as schema from "../src/db/schema.js";
import { emailTokens, sessions, users } from "../src/db/schema.js";
import { mailSettingsFromEnv } from "../src/mail/config.js";
import { createMemoryMailer, createResendMailer } from "../src/mail/mailer.js";

let app: FastifyInstance;
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mailer = createMemoryMailer();

const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "a brand new password";
type Cookies = { session: string };

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  app = await buildApp({ db, logger: false, authRateLimit: 1000, mailer, publicUrl: "https://app.test" });
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

const post = (url: string, cookies: Cookies | undefined, payload: unknown) =>
  app.inject({ method: "POST", url, ...(cookies ? { cookies } : {}), payload: payload as object });

async function register(email: string) {
  const res = await post("/auth/register", undefined, { email, password: PASSWORD });
  expect(res.statusCode).toBe(201);
  return {
    id: res.json().user.id as string,
    cookies: { session: res.cookies.find((c) => c.name === "session")!.value } as Cookies,
  };
}

const whoAmI = async (cookies: Cookies) =>
  (await app.inject({ method: "GET", url: "/auth/me", cookies })).json().user as {
    email: string;
    emailVerified: boolean;
  } | null;

const login = (email: string, password: string) => post("/auth/login", undefined, { email, password });

/** Emails are sent in the background, so wait for the one to this address to arrive. */
async function emailTo(address: string, subject: RegExp) {
  for (let i = 0; i < 50; i++) {
    const found = mailer.sent.filter((m) => m.to === address && subject.test(m.subject));
    if (found.length > 0) return found[found.length - 1]!;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no email to ${address} matching ${subject}`);
}

/** The token in the link of an email, and the path it points to. */
function linkIn(text: string) {
  const m = text.match(/https:\/\/app\.test\/([a-z-]+)\?token=([\w-]+)/);
  if (!m) throw new Error(`no link in: ${text}`);
  return { path: m[1]!, token: m[2]! };
}

/** Lets the cooldown between two emails of one kind pass without waiting for it. */
const ageTokens = (userId: string) =>
  db
    .update(emailTokens)
    .set({ createdAt: new Date(Date.now() - RESEND_COOLDOWN_MS - 1000) })
    .where(eq(emailTokens.userId, userId));

describe("verifying the email address", () => {
  it("sends a link when someone signs up, and opening it verifies the address", async () => {
    const { cookies } = await register("verify1@example.com");
    expect(await whoAmI(cookies)).toMatchObject({ emailVerified: false });

    const { path, token } = linkIn((await emailTo("verify1@example.com", /Confirm your email/)).text);
    expect(path).toBe("verify-email");
    const res = await post("/auth/verify-email", undefined, { token }); // no login needed
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "verified" });
    expect(await whoAmI(cookies)).toMatchObject({ emailVerified: true });
  });

  it("works once", async () => {
    await register("verify2@example.com");
    const { token } = linkIn((await emailTo("verify2@example.com", /Confirm your email/)).text);
    expect((await post("/auth/verify-email", undefined, { token })).statusCode).toBe(200);
    expect((await post("/auth/verify-email", undefined, { token })).statusCode).toBe(400);
  });

  it("refuses a made-up token and a malformed one", async () => {
    expect((await post("/auth/verify-email", undefined, { token: "x".repeat(43) })).statusCode).toBe(400);
    expect((await post("/auth/verify-email", undefined, { token: "short" })).statusCode).toBe(400);
  });

  it("refuses an expired link", async () => {
    const { id } = await register("verify3@example.com");
    const { token } = linkIn((await emailTo("verify3@example.com", /Confirm your email/)).text);
    await db
      .update(emailTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailTokens.userId, id));
    expect((await post("/auth/verify-email", undefined, { token })).statusCode).toBe(400);
    expect(await db.select().from(users).where(eq(users.id, id))).toMatchObject([{ emailVerifiedAt: null }]);
  });

  it("does not accept a reset link as a verification link", async () => {
    await register("verify4@example.com");
    await post("/auth/forgot-password", undefined, { email: "verify4@example.com" });
    const { token } = linkIn((await emailTo("verify4@example.com", /Reset your/)).text);
    expect((await post("/auth/verify-email", undefined, { token })).statusCode).toBe(400);
  });

  it("can be sent again from the account, but not in quick succession", async () => {
    const { id, cookies } = await register("verify5@example.com");
    expect((await post("/account/verification", undefined, {})).statusCode).toBe(401);
    expect((await post("/account/verification", cookies, {})).statusCode).toBe(429); // sign-up just sent one
    await ageTokens(id);
    const before = mailer.sent.length;
    expect((await post("/account/verification", cookies, {})).statusCode).toBe(204);
    expect(mailer.sent.length).toBe(before + 1);
    // The newest link is the one that counts.
    const sent = mailer.sent.filter((m) => m.to === "verify5@example.com");
    const [first, second] = [linkIn(sent[0]!.text).token, linkIn(sent[1]!.text).token];
    expect((await post("/auth/verify-email", undefined, { token: first })).statusCode).toBe(400);
    expect((await post("/auth/verify-email", undefined, { token: second })).statusCode).toBe(200);
    // Nothing more to send once verified.
    expect((await post("/account/verification", cookies, {})).statusCode).toBe(204);
    expect(mailer.sent.length).toBe(before + 1);
  });

  it("does not stop sign-up when the email cannot be sent", async () => {
    const failing = await buildApp({
      db,
      logger: false,
      authRateLimit: 1000,
      mailer: {
        send: async () => {
          throw new Error("provider down");
        },
      },
    });
    const res = await failing.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "verify6@example.com", password: PASSWORD },
    });
    expect(res.statusCode).toBe(201);
    await failing.close();
  });
});

describe("resetting a forgotten password", () => {
  it("emails a link, and the new password works while the old one does not", async () => {
    const { cookies } = await register("reset1@example.com");
    expect((await post("/auth/forgot-password", undefined, { email: "Reset1@Example.com" })).statusCode).toBe(204);
    const email = await emailTo("reset1@example.com", /Reset your/);
    const { path, token } = linkIn(email.text);
    expect(path).toBe("reset-password");

    const res = await post("/auth/reset-password", undefined, { token, newPassword: NEW_PASSWORD });
    expect(res.statusCode).toBe(204);
    expect((await login("reset1@example.com", NEW_PASSWORD)).statusCode).toBe(200);
    expect((await login("reset1@example.com", PASSWORD)).statusCode).toBe(401);
    // Everyone who was signed in is signed out.
    expect(await whoAmI(cookies)).toBeNull();
  });

  it("answers the same for an address with no account, and sends nothing", async () => {
    const before = mailer.sent.length;
    const res = await post("/auth/forgot-password", undefined, { email: "nobody@example.com" });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    await new Promise((r) => setTimeout(r, 50));
    expect(mailer.sent.length).toBe(before);
    expect((await post("/auth/forgot-password", undefined, { email: "not-an-email" })).statusCode).toBe(400);
  });

  it("works once", async () => {
    await register("reset2@example.com");
    await post("/auth/forgot-password", undefined, { email: "reset2@example.com" });
    const { token } = linkIn((await emailTo("reset2@example.com", /Reset your/)).text);
    expect((await post("/auth/reset-password", undefined, { token, newPassword: NEW_PASSWORD })).statusCode).toBe(204);
    expect((await post("/auth/reset-password", undefined, { token, newPassword: "another password" })).statusCode).toBe(400);
    expect((await login("reset2@example.com", NEW_PASSWORD)).statusCode).toBe(200);
  });

  it("expires after an hour", async () => {
    expect(TOKEN_TTL_MS.reset_password).toBe(60 * 60 * 1000);
    const { id } = await register("reset3@example.com");
    await post("/auth/forgot-password", undefined, { email: "reset3@example.com" });
    const { token } = linkIn((await emailTo("reset3@example.com", /Reset your/)).text);
    await db
      .update(emailTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailTokens.userId, id));
    expect((await post("/auth/reset-password", undefined, { token, newPassword: NEW_PASSWORD })).statusCode).toBe(400);
    expect((await login("reset3@example.com", PASSWORD)).statusCode).toBe(200);
  });

  it("refuses a short new password without using up the link", async () => {
    await register("reset4@example.com");
    await post("/auth/forgot-password", undefined, { email: "reset4@example.com" });
    const { token } = linkIn((await emailTo("reset4@example.com", /Reset your/)).text);
    expect((await post("/auth/reset-password", undefined, { token, newPassword: "short" })).statusCode).toBe(400);
    expect((await post("/auth/reset-password", undefined, { token, newPassword: NEW_PASSWORD })).statusCode).toBe(204);
  });

  it("does not accept a verification link as a reset link", async () => {
    await register("reset5@example.com");
    const { token } = linkIn((await emailTo("reset5@example.com", /Confirm your email/)).text);
    expect((await post("/auth/reset-password", undefined, { token, newPassword: NEW_PASSWORD })).statusCode).toBe(400);
    expect((await login("reset5@example.com", PASSWORD)).statusCode).toBe(200);
  });

  it("only the newest link works, and asking again right away sends nothing new", async () => {
    const { id } = await register("reset6@example.com");
    await post("/auth/forgot-password", undefined, { email: "reset6@example.com" });
    const first = linkIn((await emailTo("reset6@example.com", /Reset your/)).text);
    const count = () => mailer.sent.filter((m) => m.to === "reset6@example.com" && /Reset your/.test(m.subject)).length;
    expect(count()).toBe(1);

    await post("/auth/forgot-password", undefined, { email: "reset6@example.com" });
    await new Promise((r) => setTimeout(r, 50));
    expect(count()).toBe(1); // within the cooldown

    await ageTokens(id);
    await post("/auth/forgot-password", undefined, { email: "reset6@example.com" });
    for (let i = 0; i < 50 && count() < 2; i++) await new Promise((r) => setTimeout(r, 10));
    const second = linkIn(mailer.sent.filter((m) => m.to === "reset6@example.com" && /Reset your/.test(m.subject)).at(-1)!.text);
    expect(second.token).not.toBe(first.token);
    expect((await post("/auth/reset-password", undefined, { token: first.token, newPassword: NEW_PASSWORD })).statusCode).toBe(400);
    expect((await post("/auth/reset-password", undefined, { token: second.token, newPassword: NEW_PASSWORD })).statusCode).toBe(204);
  });

  it("also proves the address, since only its owner got the link", async () => {
    const { cookies } = await register("reset7@example.com");
    await post("/auth/forgot-password", undefined, { email: "reset7@example.com" });
    const { token } = linkIn((await emailTo("reset7@example.com", /Reset your/)).text);
    await post("/auth/reset-password", undefined, { token, newPassword: NEW_PASSWORD });
    const again = await login("reset7@example.com", NEW_PASSWORD);
    expect(again.json().user).toMatchObject({ emailVerified: true });
    expect(cookies.session).toBeTruthy();
  });

  it("is limited like login, so it cannot be used to flood an inbox", async () => {
    const limited = await buildApp({ db, logger: false, authRateLimit: 2, mailer: createMemoryMailer() });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push(
        (await limited.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "x@example.com" } }))
          .statusCode,
      );
    }
    expect(codes).toEqual([204, 204, 429, 429]);
    await limited.close();
  });
});

describe("changing the email address", () => {
  it("sends the link to the new address and changes it only when the link is opened", async () => {
    const { id, cookies } = await register("change1@example.com");
    const res = await post("/account/email", cookies, { email: "New1@Example.com", password: PASSWORD });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ pendingEmail: "new1@example.com" });
    expect(await whoAmI(cookies)).toMatchObject({ email: "change1@example.com" });

    const email = await emailTo("new1@example.com", /Confirm your new email/);
    const { path, token } = linkIn(email.text);
    expect(path).toBe("verify-email");
    const opened = await post("/auth/verify-email", undefined, { token });
    expect(opened.json()).toEqual({ status: "changed" });

    expect(await whoAmI(cookies)).toMatchObject({ email: "new1@example.com", emailVerified: true });
    expect((await login("new1@example.com", PASSWORD)).statusCode).toBe(200);
    expect((await login("change1@example.com", PASSWORD)).statusCode).toBe(401);
    expect(await db.select().from(sessions).where(eq(sessions.userId, id))).not.toHaveLength(0);
  });

  it("makes the address unverified until then, and a reset link for the old address stops working", async () => {
    await register("change2@example.com");
    await post("/auth/forgot-password", undefined, { email: "change2@example.com" });
    const reset = linkIn((await emailTo("change2@example.com", /Reset your/)).text);
    const { cookies } = await login("change2@example.com", PASSWORD).then((r) => ({
      cookies: { session: r.cookies.find((c) => c.name === "session")!.value },
    }));
    await post("/account/email", cookies, { email: "new2@example.com", password: PASSWORD });
    const { token } = linkIn((await emailTo("new2@example.com", /Confirm your new email/)).text);
    await post("/auth/verify-email", undefined, { token });
    expect((await post("/auth/reset-password", undefined, { token: reset.token, newPassword: NEW_PASSWORD })).statusCode).toBe(400);
  });

  it("is refused for an address that got an account in the meantime", async () => {
    const { cookies } = await register("change3@example.com");
    await post("/account/email", cookies, { email: "new3@example.com", password: PASSWORD });
    const { token } = linkIn((await emailTo("new3@example.com", /Confirm your new email/)).text);
    await register("new3@example.com");
    const res = await post("/auth/verify-email", undefined, { token });
    expect(res.statusCode).toBe(409);
    expect(await whoAmI(cookies)).toMatchObject({ email: "change3@example.com" });
  });

  it("does not send a second email within the cooldown", async () => {
    const { cookies } = await register("change4@example.com");
    expect((await post("/account/email", cookies, { email: "new4@example.com", password: PASSWORD })).statusCode).toBe(202);
    expect((await post("/account/email", cookies, { email: "new4b@example.com", password: PASSWORD })).statusCode).toBe(429);
  });

  it("reports a failure to send, and leaves the address alone", async () => {
    const failing = await buildApp({
      db,
      logger: false,
      authRateLimit: 1000,
      mailer: {
        send: async () => {
          throw new Error("provider down");
        },
      },
    });
    const reg = await failing.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "change5@example.com", password: PASSWORD },
    });
    const cookies = { session: reg.cookies.find((c) => c.name === "session")!.value };
    const res = await failing.inject({
      method: "POST",
      url: "/account/email",
      cookies,
      payload: { email: "new5@example.com", password: PASSWORD },
    });
    expect(res.statusCode).toBe(502);
    await failing.close();
  });
});

describe("deleting the account", () => {
  it("removes its pending email links", async () => {
    const { id, cookies } = await register("gone@example.com");
    expect(await db.select().from(emailTokens).where(eq(emailTokens.userId, id))).not.toHaveLength(0);
    expect((await post("/account/delete", cookies, { password: PASSWORD })).statusCode).toBe(204);
    expect(await db.select().from(emailTokens).where(eq(emailTokens.userId, id))).toHaveLength(0);
  });
});

describe("the mail settings", () => {
  const prod = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
  const full = {
    ...prod,
    RESEND_API_KEY: "re_key",
    MAIL_FROM: "Flashcards <noreply@mail.example.com>",
    PUBLIC_URL: "https://flashcards.example.com/",
  } as NodeJS.ProcessEnv;

  it("are required in production, and say which are missing", () => {
    expect(() => mailSettingsFromEnv(prod)).toThrow(/RESEND_API_KEY, MAIL_FROM, PUBLIC_URL must be set/);
    expect(() => mailSettingsFromEnv({ ...full, MAIL_FROM: "" })).toThrow(/MAIL_FROM must be set/);
    expect(mailSettingsFromEnv(full).publicUrl).toBe("https://flashcards.example.com"); // no trailing slash
  });

  it("are optional in development, which prints emails instead", () => {
    expect(mailSettingsFromEnv({} as NodeJS.ProcessEnv).publicUrl).toBe("http://localhost:5173");
  });

  it("read who is emailed about reports, and refuse something that is not an address", () => {
    expect(mailSettingsFromEnv({ ...full }).reportNotifyEmail).toBeUndefined();
    expect(mailSettingsFromEnv({ ...full, REPORT_NOTIFY_EMAIL: " me@example.com " }).reportNotifyEmail).toBe("me@example.com");
    expect(() => mailSettingsFromEnv({ ...full, REPORT_NOTIFY_EMAIL: "not an address" })).toThrow(/REPORT_NOTIFY_EMAIL/);
  });

  it("refuse a PUBLIC_URL with a path or no scheme", () => {
    expect(() => mailSettingsFromEnv({ ...full, PUBLIC_URL: "flashcards.example.com" })).toThrow(/PUBLIC_URL/);
    expect(() => mailSettingsFromEnv({ ...full, PUBLIC_URL: "https://example.com/app" })).toThrow(/PUBLIC_URL/);
  });
});

describe("the Resend mailer", () => {
  it("posts the email with the key, and reports a refusal", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = createResendMailer({
      apiKey: "re_key",
      from: "Flashcards <noreply@mail.example.com>",
      fetchFn: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return new Response('{"id":"1"}', { status: 200 });
      },
    });
    await ok.send({ to: "a@example.com", subject: "Hi", text: "Body" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer re_key");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      from: "Flashcards <noreply@mail.example.com>",
      to: ["a@example.com"],
      subject: "Hi",
      text: "Body",
    });

    const refused = createResendMailer({
      apiKey: "re_key",
      from: "x",
      fetchFn: async () => new Response('{"message":"domain not verified"}', { status: 403 }),
    });
    await expect(refused.send({ to: "a@example.com", subject: "Hi", text: "Body" })).rejects.toThrow(/403.*domain not verified/);
  });
});
