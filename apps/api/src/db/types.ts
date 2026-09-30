import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema.js";

// Works for both postgres-js (prod) and PGlite (tests).
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
