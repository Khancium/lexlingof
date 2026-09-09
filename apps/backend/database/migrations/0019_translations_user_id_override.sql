-- Adds translations.user_id (denormalized from contributions.user_id, like
-- word_recordings.user_id already is) so re-recording a translation for the
-- same sentence can override the existing row instead of creating a
-- duplicate contribution -- backfilled from the existing contribution link
-- since every current row already has one.
ALTER TABLE "translations" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "translations" t SET "user_id" = c."user_id" FROM "contributions" c WHERE c.id = t."contribution_id";--> statement-breakpoint
ALTER TABLE "translations" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_translations_user_sentence" ON "translations" USING btree ("user_id","sentence_id") WHERE "translations"."deleted_at" is null;
