CREATE TYPE "public"."submission_status" AS ENUM('pending', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "pending_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module_type" "contribution_module" NOT NULL,
	"payload" jsonb NOT NULL,
	"audio_data" "bytea",
	"audio_mime_type" text,
	"audio_filename" text,
	"audio_duration_ms" integer,
	"resolved_audio_file_id" uuid,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"contribution_id" uuid,
	"points_awarded" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_submissions" ADD CONSTRAINT "pending_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_submissions" ADD CONSTRAINT "pending_submissions_resolved_audio_file_id_audio_files_id_fk" FOREIGN KEY ("resolved_audio_file_id") REFERENCES "public"."audio_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_submissions" ADD CONSTRAINT "pending_submissions_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_pending_submissions_status" ON "pending_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_pending_submissions_user" ON "pending_submissions" USING btree ("user_id");