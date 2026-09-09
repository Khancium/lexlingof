CREATE TYPE "public"."education_level" AS ENUM('none', 'high_school', 'bachelors', 'masters', 'phd');--> statement-breakpoint
ALTER TABLE "contributor_demographics" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "contributor_demographics" ADD COLUMN "education_level" "education_level";--> statement-breakpoint
ALTER TABLE "contributor_demographics" ADD COLUMN "profession" text;