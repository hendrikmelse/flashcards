CREATE TYPE "public"."report_kind" AS ENUM('card', 'bug', 'suggestion');--> statement-breakpoint
ALTER TABLE "card_reports" ALTER COLUMN "concept_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "card_reports" ALTER COLUMN "from_language" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "card_reports" ALTER COLUMN "to_language" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "card_reports" ALTER COLUMN "reason" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "card_reports" ADD COLUMN "kind" "report_kind" DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_reports" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_reports" ADD CONSTRAINT "card_reports_card_has_word" CHECK ("card_reports"."kind" <> 'card' or ("card_reports"."concept_id" is not null and "card_reports"."from_language" is not null and "card_reports"."to_language" is not null and "card_reports"."reason" is not null));