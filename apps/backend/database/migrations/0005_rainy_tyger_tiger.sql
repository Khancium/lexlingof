ALTER TABLE "concepts" DROP CONSTRAINT "ck_concepts_difficulty_range";--> statement-breakpoint
ALTER TABLE "sentences" DROP CONSTRAINT "ck_sentences_difficulty_range";--> statement-breakpoint
ALTER TABLE "concepts" DROP COLUMN "difficulty";--> statement-breakpoint
ALTER TABLE "sentences" DROP COLUMN "difficulty";