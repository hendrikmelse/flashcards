import { migrate } from "drizzle-orm/postgres-js/migrator";
import { config } from "../config.js";
import { db, sql } from "./client.js";

await migrate(db, { migrationsFolder: config.MIGRATIONS_DIR });
await sql.end();
console.log("Migrations applied");
