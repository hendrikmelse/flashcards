import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import * as schema from "../src/db/schema.js";

let app: FastifyInstance;
let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  const db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  app = await buildApp({ db, logger: false });
}, 60_000);

afterAll(async () => {
  await app.close();
  await pg.close();
});

const creds = { email: "Ann@Example.com", password: "correct horse battery" };

function sessionCookie(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === "session");
  return c ? { session: c.value } : undefined;
}

describe("auth", () => {
  let cookies: { session: string } | undefined;

  it("rejects invalid registration input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "nope", password: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("registers, normalizes email, and sets a session cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: creds,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe("ann@example.com");
    expect(res.json().user.passwordHash).toBeUndefined();
    expect(res.cookies[0]?.httpOnly).toBe(true);
    cookies = sessionCookie(res);
    expect(cookies).toBeDefined();
  });

  it("rejects a duplicate email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: creds,
    });
    expect(res.statusCode).toBe(409);
  });

  it("returns the current user for a valid session", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/me", cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe("ann@example.com");
  });

  it("returns 401 without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/me" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a wrong password and an unknown email identically", async () => {
    const wrong = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { ...creds, password: "wrong password" },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "nobody@example.com", password: "whatever123" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("logs in with correct credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: creds,
    });
    expect(res.statusCode).toBe(200);
    expect(sessionCookie(res)).toBeDefined();
  });

  it("logout invalidates the session server-side", async () => {
    const out = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies,
    });
    expect(out.statusCode).toBe(204);
    const res = await app.inject({ method: "GET", url: "/auth/me", cookies });
    expect(res.statusCode).toBe(401);
  });
});
