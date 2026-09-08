ALTER TABLE "word_recordings" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "word_recordings" ADD CONSTRAINT "word_recordings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "word_recordings" wr
SET "user_id" = c."user_id"
FROM "contributions" c
WHERE wr."contribution_id" = c."id" AND wr."user_id" IS NULL;