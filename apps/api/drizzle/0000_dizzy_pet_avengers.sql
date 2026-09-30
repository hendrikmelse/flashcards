CREATE TYPE "public"."card_state" AS ENUM('new', 'learning', 'review', 'relearning');--> statement-breakpoint
CREATE TYPE "public"."rating" AS ENUM('again', 'hard', 'good', 'easy');--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gloss" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conceptId" uuid NOT NULL,
	"language" text NOT NULL,
	"lemma" text NOT NULL,
	"partOfSpeech" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_concept_language_lemma_uq" UNIQUE("conceptId","language","lemma")
);
--> statement-breakpoint
CREATE TABLE "entry_sentences" (
	"entryId" uuid NOT NULL,
	"sentenceId" uuid NOT NULL,
	CONSTRAINT "entry_sentences_entryId_sentenceId_pk" PRIMARY KEY("entryId","sentenceId")
);
--> statement-breakpoint
CREATE TABLE "languages" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pack_concepts" (
	"packId" uuid NOT NULL,
	"conceptId" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pack_concepts_packId_conceptId_pk" PRIMARY KEY("packId","conceptId")
);
--> statement-breakpoint
CREATE TABLE "packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userCardId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"clientReviewId" uuid NOT NULL,
	"rating" "rating" NOT NULL,
	"reviewedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"timeTakenMs" integer,
	"stateBefore" "card_state" NOT NULL,
	"stateAfter" "card_state" NOT NULL,
	"intervalBeforeDays" real NOT NULL,
	"intervalAfterDays" real NOT NULL,
	"dueAfter" timestamp with time zone NOT NULL,
	CONSTRAINT "review_logs_user_client_review_uq" UNIQUE("userId","clientReviewId")
);
--> statement-breakpoint
CREATE TABLE "sentences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language" text NOT NULL,
	"text" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"conceptId" uuid NOT NULL,
	"fromLanguage" text NOT NULL,
	"toLanguage" text NOT NULL,
	"addedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sortKey" integer DEFAULT 0 NOT NULL,
	"state" "card_state" DEFAULT 'new' NOT NULL,
	"dueAt" timestamp with time zone DEFAULT now() NOT NULL,
	"intervalDays" real DEFAULT 0 NOT NULL,
	"stability" real,
	"difficulty" real,
	"learningStep" integer DEFAULT 0 NOT NULL,
	"repetitions" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"lastReviewedAt" timestamp with time zone,
	CONSTRAINT "user_cards_user_concept_direction_uq" UNIQUE("userId","conceptId","fromLanguage","toLanguage"),
	CONSTRAINT "user_cards_languages_differ" CHECK ("user_cards"."fromLanguage" <> "user_cards"."toLanguage")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"passwordHash" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"dailyNewCardLimit" integer DEFAULT 20 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_conceptId_concepts_id_fk" FOREIGN KEY ("conceptId") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_language_languages_code_fk" FOREIGN KEY ("language") REFERENCES "public"."languages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_sentences" ADD CONSTRAINT "entry_sentences_entryId_entries_id_fk" FOREIGN KEY ("entryId") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_sentences" ADD CONSTRAINT "entry_sentences_sentenceId_sentences_id_fk" FOREIGN KEY ("sentenceId") REFERENCES "public"."sentences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_concepts" ADD CONSTRAINT "pack_concepts_packId_packs_id_fk" FOREIGN KEY ("packId") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_concepts" ADD CONSTRAINT "pack_concepts_conceptId_concepts_id_fk" FOREIGN KEY ("conceptId") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_userCardId_user_cards_id_fk" FOREIGN KEY ("userCardId") REFERENCES "public"."user_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentences" ADD CONSTRAINT "sentences_language_languages_code_fk" FOREIGN KEY ("language") REFERENCES "public"."languages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_conceptId_concepts_id_fk" FOREIGN KEY ("conceptId") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_fromLanguage_languages_code_fk" FOREIGN KEY ("fromLanguage") REFERENCES "public"."languages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_toLanguage_languages_code_fk" FOREIGN KEY ("toLanguage") REFERENCES "public"."languages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_concept_idx" ON "entries" USING btree ("conceptId");--> statement-breakpoint
CREATE INDEX "entries_language_lemma_idx" ON "entries" USING btree ("language","lemma");--> statement-breakpoint
CREATE INDEX "pack_concepts_concept_idx" ON "pack_concepts" USING btree ("conceptId");--> statement-breakpoint
CREATE INDEX "review_logs_card_idx" ON "review_logs" USING btree ("userCardId","reviewedAt");--> statement-breakpoint
CREATE INDEX "review_logs_user_idx" ON "review_logs" USING btree ("userId","reviewedAt");--> statement-breakpoint
CREATE INDEX "sentences_language_idx" ON "sentences" USING btree ("language");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "user_cards_due_idx" ON "user_cards" USING btree ("userId","dueAt");