ALTER TABLE "audio_uploads" ALTER COLUMN "title" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "english_translation" text;--> statement-breakpoint
INSERT INTO "gamification_config" ("config_key", "config_value", "description", "module")
VALUES ('points.audio.translation', '{"value": 10}', 'Bonus points for adding an English translation', NULL)
ON CONFLICT ("config_key") WHERE "is_active" = true DO NOTHING;