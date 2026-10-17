CREATE TYPE "public"."concept_grammatical_gender" AS ENUM('male', 'female', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."concept_grammatical_number" AS ENUM('singular', 'plural', 'dual');--> statement-breakpoint
CREATE TYPE "public"."concept_part_of_speech" AS ENUM('noun', 'pronoun', 'adjective', 'adverb', 'verb', 'helping_verb', 'adposition', 'conjunction');--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "grammatical_gender" "concept_grammatical_gender";--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "part_of_speech" "concept_part_of_speech";--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "grammatical_number" "concept_grammatical_number";