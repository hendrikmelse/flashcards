import { db, sql } from "./client.js";
import { seedLanguages } from "./seed.js";

// Safe to run in production: inserts only the supported languages.
await seedLanguages(db);
await sql.end();
console.log("Languages seeded");
