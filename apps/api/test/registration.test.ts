import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  mayRegister,
  registrationPolicyFromEnv,
  type RegistrationPolicy,
} from "../src/auth/registration.js";
import * as schema from "../src/db/schema.js";

describe("mayRegister", () => {
  const allowlist: RegistrationPolicy = {
    mode: "allowlist",
    allowedEmails: ["ann@example.com", "bob@example.com"],
  };

  it("lets anyone in when open", () => {
    expect(mayRegister({ mode: "open", allowedEmails: [] }, "anyone@example.com")).toBe(true);
  });

  it("lets nobody in when closed, even if emails are listed", () => {
    expect(mayRegister({ mode: "closed", allowedEmails: ["ann@example.com"] }, "ann@example.com")).toBe(false);
  });

  it("only lets listed emails in on an allowlist", () => {
    expect(mayRegister(allowlist, "ann@example.com")).toBe(true);
    expect(mayRegister(allowlist, "bob@example.com")).toBe(true);
    expect(mayRegister(allowlist, "eve@example.com")).toBe(false);
    // A look-alike must not match by substring or prefix.
    expect(mayRegister(allowlist, "ann@example.com.evil.io")).toBe(false);
    expect(mayRegister(allowlist, "xann@example.com")).toBe(false);
  });
});

describe("registrationPolicyFromEnv", () => {
  it("defaults to open outside production", () => {
    expect(registrationPolicyFromEnv({ NODE_ENV: "development" })).toMatchObject({ mode: "open" });
    expect(registrationPolicyFromEnv({})).toMatchObject({ mode: "open" });
  });

  it("refuses to start in production without an explicit choice", () => {
    expect(() => registrationPolicyFromEnv({ NODE_ENV: "production" })).toThrow(/must be set in production/);
    expect(() => registrationPolicyFromEnv({ NODE_ENV: "production", REGISTRATION_MODE: "  " })).toThrow(
      /must be set in production/,
    );
  });

  it("accepts an explicit open policy in production", () => {
    expect(registrationPolicyFromEnv({ NODE_ENV: "production", REGISTRATION_MODE: "open" })).toMatchObject({
      mode: "open",
    });
  });

  it("rejects unknown modes", () => {
    expect(() => registrationPolicyFromEnv({ REGISTRATION_MODE: "invite" })).toThrow(/open, allowlist or closed/);
  });

  it("parses and normalizes the allowlist", () => {
    const policy = registrationPolicyFromEnv({
      REGISTRATION_MODE: "allowlist",
      ALLOWED_EMAILS: " Ann@Example.com , bob@example.com,, ",
    });
    expect(policy).toEqual({
      mode: "allowlist",
      allowedEmails: ["ann@example.com", "bob@example.com"],
    });
  });

  it("refuses an allowlist with nobody on it", () => {
    expect(() => registrationPolicyFromEnv({ REGISTRATION_MODE: "allowlist" })).toThrow(/requires ALLOWED_EMAILS/);
    expect(() =>
      registrationPolicyFromEnv({ REGISTRATION_MODE: "allowlist", ALLOWED_EMAILS: " , " }),
    ).toThrow(/requires ALLOWED_EMAILS/);
  });
});

describe("POST /auth/register with a policy", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pg = new PGlite();
    db = drizzle(pg, { schema, casing: "snake_case" });
    await migrate(db, { migrationsFolder: "./drizzle" });
  }, 60_000);
  afterAll(() => pg.close());

  const register = async (policy: RegistrationPolicy, email: string) => {
    const app = await buildApp({ db, logger: false, registration: policy });
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "correct horse battery" },
    });
    await app.close();
    return res;
  };

  const allowlist: RegistrationPolicy = { mode: "allowlist", allowedEmails: ["ann@example.com"] };

  it("registers an invited email, regardless of the case typed", async () => {
    const res = await register(allowlist, "  ANN@Example.com ");
    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe("ann@example.com");
  });

  it("turns away anyone else without creating an account or a session", async () => {
    const res = await register(allowlist, "eve@example.com");
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Registration is closed" });
    expect(res.cookies).toEqual([]);
    const users = await db.select().from(schema.users);
    expect(users.map((u) => u.email)).not.toContain("eve@example.com");
  });

  it("turns away everyone when closed", async () => {
    const res = await register({ mode: "closed", allowedEmails: ["ann@example.com"] }, "bob@example.com");
    expect(res.statusCode).toBe(403);
  });

  it("still lets existing users log in when registration is closed", async () => {
    const app = await buildApp({ db, logger: false, registration: { mode: "closed", allowedEmails: [] } });
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "ann@example.com", password: "correct horse battery" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("checks the policy before the duplicate-email check, so it cannot be used to probe accounts", async () => {
    // ann exists. A non-invited email and an existing one must not be distinguishable
    // to someone who is not on the list.
    const res = await register({ mode: "closed", allowedEmails: [] }, "ann@example.com");
    expect(res.statusCode).toBe(403);
  });
});
