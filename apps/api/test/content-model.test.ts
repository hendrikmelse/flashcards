import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../src/db/seed.js";
import * as schema from "../src/db/schema.js";
import { entries, packConcepts, packs, userCards, users } from "../src/db/schema.js";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);
}, 60_000);

afterAll(async () => {
  await pg.close();
});

describe("content model", () => {
  it("derives a card in either direction from one concept", async () => {
    const from = alias(entries, "from_entry");
    const to = alias(entries, "to_entry");
    const rows = await db
      .select({ front: from.lemma, back: to.lemma })
      .from(packConcepts)
      .innerJoin(packs, eq(packs.id, packConcepts.packId))
      .innerJoin(from, and(eq(from.conceptId, packConcepts.conceptId), eq(from.language, "en")))
      .innerJoin(to, and(eq(to.conceptId, packConcepts.conceptId), eq(to.language, "nl")))
      .where(eq(packs.slug, "sample"))
      .orderBy(packConcepts.position);
    expect(rows).toEqual([
      { front: "dog", back: "hond" },
      { front: "house", back: "huis" },
      { front: "water", back: "water" },
    ]);
  });

  it("tracks each direction of a concept separately per user, without duplicates", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: "a@example.com", passwordHash: "x" })
      .returning();
    const [pack] = await db.select().from(packs).where(eq(packs.slug, "sample"));
    const [pc] = await db
      .select()
      .from(packConcepts)
      .where(eq(packConcepts.packId, pack!.id))
      .limit(1);
    const base = { userId: user!.id, conceptId: pc!.conceptId };

    await db.insert(userCards).values({ ...base, fromLanguage: "en", toLanguage: "nl" });
    await db.insert(userCards).values({ ...base, fromLanguage: "nl", toLanguage: "en" });
    await expect(
      db.insert(userCards).values({ ...base, fromLanguage: "en", toLanguage: "nl" }),
    ).rejects.toThrow();
    await expect(
      db.insert(userCards).values({ ...base, fromLanguage: "en", toLanguage: "en" }),
    ).rejects.toThrow();
  });
});
