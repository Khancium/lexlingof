CREATE TYPE "public"."pending_change_action" AS ENUM('create', 'delete');--> statement-breakpoint
CREATE TYPE "public"."pending_change_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."pending_change_target_type" AS ENUM('category', 'concept', 'scene', 'sentence', 'concept_media', 'scene_media');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'volunteer' BEFORE 'contributor';--> statement-breakpoint
CREATE TABLE "pending_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"target_type" "pending_change_target_type" NOT NULL,
	"action" "pending_change_action" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "pending_change_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"result_resource_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "sentences" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auto_approve_volunteer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_changes" ADD CONSTRAINT "pending_changes_volunteer_id_users_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_changes" ADD CONSTRAINT "pending_changes_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_pending_changes_volunteer" ON "pending_changes" USING btree ("volunteer_id");--> statement-breakpoint
CREATE INDEX "ix_pending_changes_status" ON "pending_changes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_pending_changes_target_type" ON "pending_changes" USING btree ("target_type");--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentences" ADD CONSTRAINT "sentences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;