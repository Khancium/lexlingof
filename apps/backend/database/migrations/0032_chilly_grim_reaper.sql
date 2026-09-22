ALTER TABLE "suggestions" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "image_storage_key" text;--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "concept_id" uuid;--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "scene_id" uuid;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE no action ON UPDATE no action;