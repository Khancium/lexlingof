-- Adds cool-off expiry to the existing suspend mechanism, plus a lighter
-- "restricted" state (still lets the user log in and browse, but blocks new
-- contribution submissions) for the admin Users module.
ALTER TABLE "users" ADD COLUMN "suspended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "restricted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "restricted_reason" text;
