ALTER TABLE "report_comments" ADD COLUMN "from_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- A report's single reply becomes the first admin message of its conversation, dated when the
-- report was resolved (or sent, if it was only replied to).
INSERT INTO "report_comments" ("report_id", "body", "from_admin", "created_at")
SELECT "id", "response", true, COALESCE("resolved_at", "created_at") FROM "card_reports" WHERE "response" <> '';--> statement-breakpoint
ALTER TABLE "card_reports" DROP COLUMN "response";
