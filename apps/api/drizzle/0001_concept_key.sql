ALTER TABLE "concepts" ADD COLUMN "key" text;--> statement-breakpoint
-- Concepts that predate keys get a placeholder. The content importer adopts a
-- 'legacy:' concept with the same gloss and gives it its real key; on a fresh
-- database there are no rows and this does nothing.
UPDATE "concepts" SET "key" = 'legacy:' || "id" WHERE "key" IS NULL;--> statement-breakpoint
ALTER TABLE "concepts" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_key_unique" UNIQUE("key");
