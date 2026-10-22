ALTER TABLE "card_reports" DROP CONSTRAINT "card_reports_card_has_word";--> statement-breakpoint
ALTER TABLE "card_reports" DROP CONSTRAINT "card_reports_concept_id_concepts_id_fk";
--> statement-breakpoint
ALTER TABLE "card_reports" ADD CONSTRAINT "card_reports_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_reports" ADD CONSTRAINT "card_reports_card_has_languages" CHECK ("card_reports"."kind" <> 'card' or ("card_reports"."from_language" is not null and "card_reports"."to_language" is not null and "card_reports"."reason" is not null));--> statement-breakpoint
-- Word problems already sent: save the word as text, as new ones now are, so they survive its deletion.
UPDATE "card_reports" AS r SET "title" = left(
  coalesce((SELECT string_agg(e."lemma", ', ' ORDER BY e."lemma") FROM "entries" e WHERE e."concept_id" = r."concept_id" AND e."language" = r."from_language"), '')
  || ' → ' ||
  coalesce((SELECT string_agg(e."lemma", ', ' ORDER BY e."lemma") FROM "entries" e WHERE e."concept_id" = r."concept_id" AND e."language" = r."to_language"), ''),
  100)
WHERE r."kind" = 'card' AND r."title" = '' AND r."concept_id" IS NOT NULL;
