ALTER TABLE "published_translations" ADD COLUMN "native_text" text;--> statement-breakpoint
ALTER TABLE "published_translations" ADD COLUMN "roman_text" text;--> statement-breakpoint
ALTER TABLE "published_translations" ADD COLUMN "ipa_text" text;--> statement-breakpoint
ALTER TABLE "published_translations" ADD COLUMN "text_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "published_word_recordings" ADD COLUMN "native_text" text;--> statement-breakpoint
ALTER TABLE "published_word_recordings" ADD COLUMN "roman_text" text;--> statement-breakpoint
ALTER TABLE "published_word_recordings" ADD COLUMN "ipa_text" text;--> statement-breakpoint
ALTER TABLE "published_word_recordings" ADD COLUMN "text_edited_at" timestamp with time zone;