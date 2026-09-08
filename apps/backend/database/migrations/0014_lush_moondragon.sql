CREATE TABLE "scene_image_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_media_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scene_image_keywords" ADD CONSTRAINT "scene_image_keywords_scene_media_id_scene_media_id_fk" FOREIGN KEY ("scene_media_id") REFERENCES "public"."scene_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_scene_image_keywords_media_keyword" ON "scene_image_keywords" USING btree ("scene_media_id","keyword");--> statement-breakpoint
CREATE INDEX "ix_scene_image_keywords_media" ON "scene_image_keywords" USING btree ("scene_media_id");