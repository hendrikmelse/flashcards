ALTER TABLE "review_logs" ADD COLUMN "card_before" jsonb;--> statement-breakpoint
ALTER TABLE "review_logs" ADD COLUMN "undone_at" timestamp with time zone;