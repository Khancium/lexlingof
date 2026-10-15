CREATE TABLE "published_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sentence_id" uuid NOT NULL,
	"translation_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "published_word_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_id" uuid NOT NULL,
	"word_recording_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "published_translations" ADD CONSTRAINT "published_translations_sentence_id_sentences_id_fk" FOREIGN KEY ("sentence_id") REFERENCES "public"."sentences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_translations" ADD CONSTRAINT "published_translations_translation_id_translations_id_fk" FOREIGN KEY ("translation_id") REFERENCES "public"."translations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_translations" ADD CONSTRAINT "published_translations_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_word_recordings" ADD CONSTRAINT "published_word_recordings_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_word_recordings" ADD CONSTRAINT "published_word_recordings_word_recording_id_word_recordings_id_fk" FOREIGN KEY ("word_recording_id") REFERENCES "public"."word_recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_word_recordings" ADD CONSTRAINT "published_word_recordings_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_published_translations_translation" ON "published_translations" USING btree ("translation_id");--> statement-breakpoint
CREATE INDEX "ix_published_translations_sentence" ON "published_translations" USING btree ("sentence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_published_word_recordings_recording" ON "published_word_recordings" USING btree ("word_recording_id");--> statement-breakpoint
CREATE INDEX "ix_published_word_recordings_concept" ON "published_word_recordings" USING btree ("concept_id");