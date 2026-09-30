import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Set to "true" only when the app is reachable exclusively through a trusted
  // reverse proxy (it then believes X-Forwarded-For for the client IP, which
  // keys the rate limiter). Never enable this when the app is exposed directly.
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Directory of the built web app. When set, the API serves it (and falls
  // back to index.html for client-side routes).
  WEB_DIST: z.string().min(1).optional(),
  MIGRATIONS_DIR: z.string().min(1).default("./drizzle"),
});

export const config = envSchema.parse(process.env);
