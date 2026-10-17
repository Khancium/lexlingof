ALTER TABLE "word_recordings" ADD COLUMN "grammatical_gender" "concept_grammatical_gender";--> statement-breakpoint
ALTER TABLE "word_recordings" ADD COLUMN "part_of_speech" "concept_part_of_speech";--> statement-breakpoint
ALTER TABLE "word_recordings" ADD COLUMN "grammatical_number" "concept_grammatical_number";--> statement-breakpoint
ALTER TABLE "concepts" DROP COLUMN "grammatical_gender";--> statement-breakpoint
ALTER TABLE "concepts" DROP COLUMN "part_of_speech";--> statement-breakpoint
ALTER TABLE "concepts" DROP COLUMN "grammatical_number";