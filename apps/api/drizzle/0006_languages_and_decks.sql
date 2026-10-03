CREATE TABLE "pack_texts" (
	"pack_id" uuid NOT NULL,
	"language" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "pack_texts_pack_id_language_pk" PRIMARY KEY("pack_id","language")
);
--> statement-breakpoint
ALTER TABLE "packs" ADD COLUMN "target" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_from" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_to" text;--> statement-breakpoint
ALTER TABLE "pack_texts" ADD CONSTRAINT "pack_texts_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_texts" ADD CONSTRAINT "pack_texts_language_languages_code_fk" FOREIGN KEY ("language") REFERENCES "public"."languages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_target_languages_code_fk" FOREIGN KEY ("target") REFERENCES "public"."languages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_active_from_languages_code_fk" FOREIGN KEY ("active_from") REFERENCES "public"."languages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_active_to_languages_code_fk" FOREIGN KEY ("active_to") REFERENCES "public"."languages"("code") ON DELETE no action ON UPDATE no action;