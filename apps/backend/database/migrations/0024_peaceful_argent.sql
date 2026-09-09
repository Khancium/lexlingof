ALTER TABLE "audio_files" ADD COLUMN "review_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_files" ADD COLUMN "correct_review_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_files" ADD COLUMN "incorrect_review_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_files" ADD COLUMN "cannot_decide_review_count" integer DEFAULT 0 NOT NULL;