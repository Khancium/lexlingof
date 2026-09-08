ALTER TABLE "word_recordings" DROP CONSTRAINT "ck_word_recording_take_index";--> statement-breakpoint
DROP INDEX "uq_word_recordings_take";--> statement-breakpoint
ALTER TABLE "word_recordings" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_word_recordings_user_concept_synonym" ON "word_recordings" USING btree ("user_id","concept_id","synonym_index") WHERE "word_recordings"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "word_recordings" DROP COLUMN "take_index";