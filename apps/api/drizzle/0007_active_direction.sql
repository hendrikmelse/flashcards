ALTER TABLE "users" ADD COLUMN "active_from" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_to" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_active_from_languages_code_fk" FOREIGN KEY ("active_from") REFERENCES "public"."languages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_active_to_languages_code_fk" FOREIGN KEY ("active_to") REFERENCES "public"."languages"("code") ON DELETE no action ON UPDATE no action;