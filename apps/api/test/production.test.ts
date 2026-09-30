import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { deleteExpiredSessions } from "../src/auth/sessions.js";
import * as schema from "../src/db/schema.js";
import { sessions, users } from "../src/db/schema.js";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let webDir: string;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });

  webDir = mkdtempSync(join(tmpdir(), "flashcards-web-"));
  mkdirSync(join(webDir, "assets"));
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>Flashcards</title>");
  writeFileSync(join(webDir, "assets", "app-abc123.js"), "console.log('hi')");
}, 60_000);

afterAll(() => pg.close());

const build = (opts: Parameters<typeof buildApp>[0] extends infer O ? Partial<O> : never = {}) =>
  buildApp({ db, logger: false, ...opts });

describe("production serving", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await build({ prefix: "/api", staticDir: webDir, production: true });
  });
  afterAll(() => app.close());

  it("serves the app shell at / and for client-side routes", async () => {
    for (const url of ["/", "/packs", "/packs/123?from=en&to=nl", "/study"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body).toContain("<title>Flashcards</title>");
    }
  });

  it("caches hashed assets forever but never the app shell", async () => {
    const asset = await app.inject({ method: "GET", url: "/assets/app-abc123.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    const shell = await app.inject({ method: "GET", url: "/" });
    expect(shell.headers["cache-control"]).toBe("no-cache");
  });

  it("keeps API 404s and missing files as real 404s, not the app shell", async () => {
    const api = await app.inject({ method: "GET", url: "/api/nope" });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: "Not found" });
    const file = await app.inject({ method: "GET", url: "/assets/missing.js" });
    expect(file.statusCode).toBe(404);
    const post = await app.inject({ method: "POST", url: "/packs" });
    expect(post.statusCode).toBe(404);
  });

  it("mounts the API under the prefix only", async () => {
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/languages" })).statusCode).toBe(200);
    // Unprefixed, /health is not an API route; it falls through to the app shell.
    const bare = await app.inject({ method: "GET", url: "/health" });
    expect(bare.headers["content-type"]).toContain("text/html");
  });

  it("sends security headers, with HSTS and upgrade-insecure-requests in production", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["strict-transport-security"]).toBe("max-age=15552000");
    expect(String(res.headers["content-security-policy"])).toContain("default-src 'self'");
    expect(String(res.headers["content-security-policy"])).toContain("upgrade-insecure-requests");
  });

  it("marks the session cookie Secure only when NODE_ENV is production", async () => {
    const register = async (email: string) => {
      const a = await build({ prefix: "/api" });
      const res = await a.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email, password: "correct horse battery" },
      });
      await a.close();
      expect(res.statusCode).toBe(201);
      return res.cookies[0];
    };

    // authRoutes reads NODE_ENV when it is registered, so set it around buildApp.
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(await register("secure@example.com")).toMatchObject({
        name: "session",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      });
      process.env.NODE_ENV = "development";
      expect((await register("plain@example.com"))?.secure).toBeFalsy();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe("development defaults", () => {
  it("omits HSTS and upgrade-insecure-requests so plain http keeps working", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["strict-transport-security"]).toBeUndefined();
    expect(String(res.headers["content-security-policy"])).not.toContain("upgrade-insecure-requests");
    await app.close();
  });
});

describe("health and readiness", () => {
  it("liveness does not depend on the database; readiness does", async () => {
    const app = await build({ prefix: "/api" });
    expect((await app.inject({ method: "GET", url: "/api/ready" })).statusCode).toBe(200);

    const broken = await build({
      db: {
        execute: () => Promise.reject(new Error("db down")),
      } as unknown as typeof db,
    });
    expect((await broken.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    const ready = await broken.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: "unavailable" });
    await app.close();
    await broken.close();
  });
});

describe("cross-origin protection", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await build({ prefix: "/api" });
  });
  afterAll(() => app.close());

  const post = (headers: Record<string, string>) =>
    app.inject({ method: "POST", url: "/api/auth/logout", headers });

  it("blocks state-changing requests from another origin", async () => {
    const res = await post({ host: "flashcards.example.com", origin: "https://evil.example" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Cross-origin request blocked" });
  });

  it("blocks opaque and malformed origins", async () => {
    expect((await post({ host: "flashcards.example.com", origin: "null" })).statusCode).toBe(403);
    expect((await post({ host: "flashcards.example.com", origin: "%%%" })).statusCode).toBe(403);
  });

  it("allows same-origin requests and clients that send no Origin", async () => {
    const same = await post({ host: "flashcards.example.com", origin: "https://flashcards.example.com" });
    expect(same.statusCode).toBe(204);
    const none = await post({ host: "flashcards.example.com" });
    expect(none.statusCode).toBe(204);
  });

  it("never blocks reads", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/languages",
      headers: { host: "flashcards.example.com", origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("rate limiting behind a proxy", () => {
  const hammer = async (app: FastifyInstance, ip: (i: number) => string, n: number) => {
    const codes: number[] = [];
    for (let i = 0; i < n; i++) {
      // Empty body: rejected with 400 quickly, but still counted by the limiter.
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "x-forwarded-for": ip(i) },
        payload: {},
      });
      codes.push(res.statusCode);
    }
    return codes;
  };

  it("with trustProxy, limits each client IP separately", async () => {
    const app = await build({ trustProxy: true });
    const a = await hammer(app, () => "203.0.113.1", 11);
    expect(a.slice(0, 10).every((c) => c === 400)).toBe(true);
    expect(a[10]).toBe(429);
    // A different client is unaffected by the first one's attempts.
    const b = await hammer(app, () => "203.0.113.2", 1);
    expect(b).toEqual([400]);
    await app.close();
  });

  it("without trustProxy, ignores spoofed X-Forwarded-For", async () => {
    const app = await build({ trustProxy: false });
    // Rotating the header must not dodge the limit.
    const codes = await hammer(app, (i) => `198.51.100.${i}`, 11);
    expect(codes[10]).toBe(429);
    await app.close();
  });
});

describe("session cleanup", () => {
  it("removes only expired sessions", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: "cleanup@example.com", passwordHash: "x" })
      .returning();
    const now = Date.now();
    await db.insert(sessions).values([
      { id: "expired-1", userId: user!.id, expiresAt: new Date(now - 1000) },
      { id: "expired-2", userId: user!.id, expiresAt: new Date(now - 86_400_000) },
      { id: "valid-1", userId: user!.id, expiresAt: new Date(now + 86_400_000) },
    ]);

    expect(await deleteExpiredSessions(db)).toBe(2);
    const left = await db.select().from(sessions).where(eq(sessions.userId, user!.id));
    expect(left.map((s) => s.id)).toEqual(["valid-1"]);
    expect(await deleteExpiredSessions(db)).toBe(0);
  });
});
