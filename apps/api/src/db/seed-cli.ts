import { db, sql } from "./client.js";
import { seed } from "./seed.js";

await seed(db);
await sql.end();
console.log("Seed complete");
