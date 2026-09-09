ALTER TABLE "contribution_keywords" ADD COLUMN "audio_file_id" uuid;--> statement-breakpoint
-- Backfill existing rows from whichever module-specific payload table the
-- keyword's contribution points at, so pre-existing keywords also become
-- self-contained instead of only new ones going forward.
UPDATE "contribution_keywords" ck
SET "audio_file_id" = wr."audio_file_id"
FROM "contributions" c
INNER JOIN "word_recordings" wr ON wr.id = c.word_recording_id
WHERE ck.contribution_id = c.id AND ck."audio_file_id" IS NULL;--> statement-breakpoint
UPDATE "contribution_keywords" ck
SET "audio_file_id" = au."audio_file_id"
FROM "contributions" c
INNER JOIN "audio_uploads" au ON au.id = c.audio_upload_id
WHERE ck.contribution_id = c.id AND ck."audio_file_id" IS NULL;--> statement-breakpoint
UPDATE "contribution_keywords" ck
SET "audio_file_id" = t."audio_file_id"
FROM "contributions" c
INNER JOIN "translations" t ON t.id = c.translation_id
WHERE ck.contribution_id = c.id AND ck."audio_file_id" IS NULL;--> statement-breakpoint
UPDATE "contribution_keywords" ck
SET "audio_file_id" = sc."audio_file_id"
FROM "contributions" c
INNER JOIN "scene_contributions" sc ON sc.id = c.scene_contribution_id
WHERE ck.contribution_id = c.id AND ck."audio_file_id" IS NULL;--> statement-breakpoint
ALTER TABLE "contribution_keywords" ADD CONSTRAINT "contribution_keywords_audio_file_id_audio_files_id_fk" FOREIGN KEY ("audio_file_id") REFERENCES "public"."audio_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_contribution_keywords_audio_file" ON "contribution_keywords" USING btree ("audio_file_id");