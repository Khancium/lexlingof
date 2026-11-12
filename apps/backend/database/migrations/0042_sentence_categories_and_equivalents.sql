CREATE TABLE "sentence_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_english" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sentence_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "sentences" ADD COLUMN "urdu_text" text;--> statement-breakpoint
ALTER TABLE "sentences" ADD COLUMN "persian_text" text;--> statement-breakpoint
ALTER TABLE "sentences" ADD COLUMN "sentence_category_id" uuid;--> statement-breakpoint
ALTER TABLE "sentences" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sentences" ADD CONSTRAINT "sentences_sentence_category_id_sentence_categories_id_fk" FOREIGN KEY ("sentence_category_id") REFERENCES "public"."sentence_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_sentences_category_order" ON "sentences" USING btree ("sentence_category_id","sort_order") WHERE "sentences"."deleted_at" is null;
--> statement-breakpoint
-- Same posture as 0015/0041: RLS on with no policies. The backend connects as a role that bypasses RLS; this
-- only closes the Supabase Data API (anon/authenticated keys) for the new table.
ALTER TABLE "sentence_categories" ENABLE ROW LEVEL SECURITY;
