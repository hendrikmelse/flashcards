CREATE TYPE "public"."report_reason" AS ENUM('translation', 'forms', 'sentence', 'other');--> statement-breakpoint
CREATE TABLE "card_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"concept_id" uuid NOT NULL,
	"from_language" text NOT NULL,
	"to_language" text NOT NULL,
	"reason" "report_reason" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "card_reports" ADD CONSTRAINT "card_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_reports" ADD CONSTRAINT "card_reports_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_reports" ADD CONSTRAINT "card_reports_from_language_languages_code_fk" FOREIGN KEY ("from_language") REFERENCES "public"."languages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_reports" ADD CONSTRAINT "card_reports_to_language_languages_code_fk" FOREIGN KEY ("to_language") REFERENCES "public"."languages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_reports_open_idx" ON "card_reports" USING btree ("resolved_at","created_at");