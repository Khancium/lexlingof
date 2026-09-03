CREATE TYPE "public"."audio_format" AS ENUM('wav', 'mp3', 'm4a', 'aac', 'opus', 'webm', 'flac', 'ogg');--> statement-breakpoint
CREATE TYPE "public"."audio_processing_status" AS ENUM('pending_upload', 'uploaded', 'processing', 'ready', 'failed', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."badge_trigger_type" AS ENUM('contribution_count', 'verified_count', 'streak_days', 'module_completion', 'level_reached', 'review_count', 'manual');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('granted', 'withdrawn', 'pending', 'expired');--> statement-breakpoint
CREATE TYPE "public"."contribution_module" AS ENUM('WORD', 'TRANSCRIPTION', 'TRANSLATION', 'SCENE');--> statement-breakpoint
CREATE TYPE "public"."contribution_status" AS ENUM('draft', 'pending', 'under_review', 'verified', 'needs_correction', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."contributor_level" AS ENUM('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');--> statement-breakpoint
CREATE TYPE "public"."data_access_level" AS ENUM('public', 'community', 'research', 'restricted', 'private');--> statement-breakpoint
CREATE TYPE "public"."export_format" AS ENUM('json', 'csv', 'jsonl', 'audio_archive');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'push');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'delivered', 'failed', 'read');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('valid', 'needs_correction', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."scene_difficulty" AS ENUM('easy', 'medium', 'hard', 'expert');--> statement-breakpoint
CREATE TYPE "public"."streak_status" AS ENUM('active', 'broken', 'grace');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'admin', 'contributor');--> statement-breakpoint
CREATE TABLE "audio_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"storage_bucket" text DEFAULT 'lexlingo-audio' NOT NULL,
	"original_filename" text,
	"mime_type" text NOT NULL,
	"format" "audio_format" NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"duration_ms" integer,
	"sample_rate_hz" integer,
	"channels" smallint,
	"checksum_sha256" text NOT NULL,
	"processing_status" "audio_processing_status" DEFAULT 'pending_upload' NOT NULL,
	"processing_error" text,
	"processing_completed_at" timestamp with time zone,
	"normalized_storage_key" text,
	"waveform_storage_key" text,
	"virus_scan_status" text DEFAULT 'pending' NOT NULL,
	"virus_scan_at" timestamp with time zone,
	"cdn_url" text,
	"access_level" "data_access_level" DEFAULT 'public' NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"upload_ip" text,
	"upload_user_agent" text,
	"upload_device_id" text,
	"upload_app_version" text,
	"module_type" "contribution_module" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deletion_scheduled_at" timestamp with time zone,
	CONSTRAINT "audio_files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "audio_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid,
	"audio_file_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"recording_type" text NOT NULL,
	"location" text,
	"recorded_at" date,
	"speaker_description" text,
	"cultural_context" text,
	"source" text,
	"third_party_consent" boolean DEFAULT false NOT NULL,
	"transcription_status" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_role" "user_role",
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"ip_address" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL,
	"category" text NOT NULL,
	"trigger_type" "badge_trigger_type" NOT NULL,
	"trigger_value" integer,
	"trigger_module" "contribution_module",
	"is_active" boolean DEFAULT true NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badges_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_english" text NOT NULL,
	"icon" text,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "concept_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"public_url" text,
	"mime_type" text NOT NULL,
	"file_size_bytes" bigint,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label_english" text NOT NULL,
	"description" text,
	"difficulty" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_concepts_difficulty_range" CHECK ("concepts"."difficulty" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_version" text NOT NULL,
	"consent_status" "consent_status" DEFAULT 'granted' NOT NULL,
	"consented_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"license" text DEFAULT 'CC-BY-4.0' NOT NULL,
	"research_permission" boolean DEFAULT true NOT NULL,
	"commercial_permission" boolean DEFAULT false NOT NULL,
	"ai_training_permission" boolean DEFAULT false NOT NULL,
	"is_own_content" boolean DEFAULT true NOT NULL,
	"access_level" "data_access_level" DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module_type" "contribution_module" NOT NULL,
	"language_id" uuid NOT NULL,
	"dialect_id" uuid,
	"status" "contribution_status" DEFAULT 'pending' NOT NULL,
	"base_points" integer DEFAULT 0 NOT NULL,
	"bonus_points" integer DEFAULT 0 NOT NULL,
	"total_points" integer GENERATED ALWAYS AS (base_points + bonus_points) STORED,
	"points_awarded" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejection_reason" text,
	"quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spam_score" numeric(3, 2),
	"word_recording_id" uuid,
	"audio_upload_id" uuid,
	"translation_id" uuid,
	"scene_contribution_id" uuid,
	"device_id" text,
	"app_version" text,
	"client_type" text,
	"ip_address" text,
	"access_level" "data_access_level" DEFAULT 'public' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_contribution_single_reference" CHECK (("contributions"."word_recording_id" IS NOT NULL)::int + ("contributions"."audio_upload_id" IS NOT NULL)::int + ("contributions"."translation_id" IS NOT NULL)::int + ("contributions"."scene_contribution_id" IS NOT NULL)::int = 1),
	CONSTRAINT "ck_contribution_base_points" CHECK ("contributions"."base_points" >= 0),
	CONSTRAINT "ck_contribution_bonus_points" CHECK ("contributions"."bonus_points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "contributor_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"primary_language_id" uuid,
	"primary_dialect_id" uuid,
	"location_country" text,
	"location_region" text,
	"location_city" text,
	"location_village" text,
	"tribe" text,
	"age_range" text,
	"speaker_notes" text,
	"public_profile" boolean DEFAULT true NOT NULL,
	"show_location" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"export_format" "export_format" NOT NULL,
	"status" "export_status" DEFAULT 'pending' NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" bigint,
	"file_size_bytes" bigint,
	"storage_key" text,
	"download_url" text,
	"download_expires_at" timestamp with time zone,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "dialects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_english" text NOT NULL,
	"name_native" text,
	"region" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flag_key" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"description" text NOT NULL,
	"rollout_percent" integer DEFAULT 100 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_flag_key_unique" UNIQUE("flag_key"),
	CONSTRAINT "ck_feature_flags_rollout_percent" CHECK ("feature_flags"."rollout_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "gamification_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_key" text NOT NULL,
	"config_value" jsonb NOT NULL,
	"description" text NOT NULL,
	"module" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"iso_639_3" text,
	"name_english" text NOT NULL,
	"name_native" text NOT NULL,
	"script_code" text,
	"text_direction" text DEFAULT 'ltr' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "languages_code_unique" UNIQUE("code"),
	CONSTRAINT "languages_iso_639_3_unique" UNIQUE("iso_639_3")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"period_key" text NOT NULL,
	"rank" integer NOT NULL,
	"total_points" integer NOT NULL,
	"verified_contributions" integer NOT NULL,
	"display_name" text NOT NULL,
	"level" "contributor_level" NOT NULL,
	"language_code" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"notification_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_reason" text,
	"retry_count" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "perks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"perk_type" text NOT NULL,
	"required_level" "contributor_level" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "perks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "points_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"contribution_id" uuid,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"module_type" "contribution_module",
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_id" text,
	"user_agent" text,
	"ip_address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" "review_decision" NOT NULL,
	"reason" text,
	"notes" text,
	"status_before" "contribution_status" NOT NULL,
	"status_after" "contribution_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role" "user_role" NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_permission_id_pk" PRIMARY KEY("role","permission_id")
);
--> statement-breakpoint
CREATE TABLE "scene_concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"importance" integer DEFAULT 1 NOT NULL,
	"annotated_presence" boolean,
	"annotation_source" text,
	"annotation_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_scene_concepts_importance_range" CHECK ("scene_concepts"."importance" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "scene_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid,
	"scene_id" uuid NOT NULL,
	"audio_file_id" uuid NOT NULL,
	"transcription" text,
	"transcription_added_at" timestamp with time zone,
	"transcription_added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scene_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"public_url" text,
	"mime_type" text NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"difficulty" "scene_difficulty" DEFAULT 'medium' NOT NULL,
	"estimated_duration_seconds" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_daily" boolean DEFAULT false NOT NULL,
	"daily_date" date,
	"version" integer DEFAULT 1 NOT NULL,
	"concept_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sentences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"english_text" text NOT NULL,
	"category_id" uuid,
	"difficulty" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_sentences_difficulty_range" CHECK ("sentences"."difficulty" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "streaks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"status" "streak_status" DEFAULT 'active' NOT NULL,
	"last_activity_date" date DEFAULT current_date NOT NULL,
	"last_activity_tz" text DEFAULT 'UTC' NOT NULL,
	"qualifying_contributions_today" integer DEFAULT 0 NOT NULL,
	"streak_started_at" timestamp with time zone,
	"last_break_date" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcription_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audio_upload_id" uuid NOT NULL,
	"transcription_id" uuid,
	"segment_index" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"native_text" text,
	"romanization" text,
	"ipa" text,
	"speaker_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_transcription_segment_start" CHECK ("transcription_segments"."start_ms" >= 0),
	CONSTRAINT "ck_transcription_segment_order" CHECK ("transcription_segments"."end_ms" > "transcription_segments"."start_ms")
);
--> statement-breakpoint
CREATE TABLE "transcriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audio_upload_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"native_text" text,
	"romanization" text,
	"ipa" text,
	"version" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"previous_version" uuid,
	"completeness" text DEFAULT 'partial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid,
	"sentence_id" uuid NOT NULL,
	"audio_file_id" uuid,
	"native_text" text NOT NULL,
	"romanization" text,
	"ipa" text,
	"notes" text,
	"variant_index" smallint DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"previous_version" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_additional_permissions" (
	"user_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "user_additional_permissions_user_id_permission_id_pk" PRIMARY KEY("user_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"badge_id" uuid NOT NULL,
	"trigger_contribution_id" uuid,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"total_contributions" integer DEFAULT 0 NOT NULL,
	"verified_contributions" integer DEFAULT 0 NOT NULL,
	"pending_contributions" integer DEFAULT 0 NOT NULL,
	"rejected_contributions" integer DEFAULT 0 NOT NULL,
	"word_contributions" integer DEFAULT 0 NOT NULL,
	"audio_contributions" integer DEFAULT 0 NOT NULL,
	"translation_contributions" integer DEFAULT 0 NOT NULL,
	"scene_contributions_count" integer DEFAULT 0 NOT NULL,
	"verified_words" integer DEFAULT 0 NOT NULL,
	"verified_audios" integer DEFAULT 0 NOT NULL,
	"verified_translations" integer DEFAULT 0 NOT NULL,
	"verified_scenes" integer DEFAULT 0 NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"points_this_week" integer DEFAULT 0 NOT NULL,
	"points_this_month" integer DEFAULT 0 NOT NULL,
	"level" "contributor_level" DEFAULT 'BRONZE' NOT NULL,
	"reviews_completed" integer DEFAULT 0 NOT NULL,
	"total_audio_duration_ms" bigint DEFAULT 0 NOT NULL,
	"last_contribution_at" timestamp with time zone,
	"last_contribution_module" "contribution_module",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'contributor' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_suspended" boolean DEFAULT false NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"last_seen_at" timestamp with time zone,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"biography" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "word_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid,
	"concept_id" uuid NOT NULL,
	"audio_file_id" uuid NOT NULL,
	"native_word" text NOT NULL,
	"romanization" text,
	"ipa" text,
	"synonym_index" smallint DEFAULT 1 NOT NULL,
	"take_index" smallint DEFAULT 1 NOT NULL,
	"duration_ms" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"superseded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_word_recording_max_duration" CHECK ("word_recordings"."duration_ms" <= 3000),
	CONSTRAINT "ck_word_recording_min_duration" CHECK ("word_recordings"."duration_ms" > 0),
	CONSTRAINT "ck_word_recording_synonym_index" CHECK ("word_recordings"."synonym_index" between 1 and 3),
	CONSTRAINT "ck_word_recording_take_index" CHECK ("word_recordings"."take_index" between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "audio_files" ADD CONSTRAINT "audio_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_uploads" ADD CONSTRAINT "audio_uploads_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_uploads" ADD CONSTRAINT "audio_uploads_audio_file_id_audio_files_id_fk" FOREIGN KEY ("audio_file_id") REFERENCES "public"."audio_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_media" ADD CONSTRAINT "concept_media_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_dialect_id_dialects_id_fk" FOREIGN KEY ("dialect_id") REFERENCES "public"."dialects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_word_recording_id_word_recordings_id_fk" FOREIGN KEY ("word_recording_id") REFERENCES "public"."word_recordings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_audio_upload_id_audio_uploads_id_fk" FOREIGN KEY ("audio_upload_id") REFERENCES "public"."audio_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_translation_id_translations_id_fk" FOREIGN KEY ("translation_id") REFERENCES "public"."translations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_scene_contribution_id_scene_contributions_id_fk" FOREIGN KEY ("scene_contribution_id") REFERENCES "public"."scene_contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_profiles" ADD CONSTRAINT "contributor_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_profiles" ADD CONSTRAINT "contributor_profiles_primary_language_id_languages_id_fk" FOREIGN KEY ("primary_language_id") REFERENCES "public"."languages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_profiles" ADD CONSTRAINT "contributor_profiles_primary_dialect_id_dialects_id_fk" FOREIGN KEY ("primary_dialect_id") REFERENCES "public"."dialects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialects" ADD CONSTRAINT "dialects_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gamification_config" ADD CONSTRAINT "gamification_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_concepts" ADD CONSTRAINT "scene_concepts_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_concepts" ADD CONSTRAINT "scene_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_concepts" ADD CONSTRAINT "scene_concepts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_contributions" ADD CONSTRAINT "scene_contributions_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_contributions" ADD CONSTRAINT "scene_contributions_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_contributions" ADD CONSTRAINT "scene_contributions_audio_file_id_audio_files_id_fk" FOREIGN KEY ("audio_file_id") REFERENCES "public"."audio_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_contributions" ADD CONSTRAINT "scene_contributions_transcription_added_by_users_id_fk" FOREIGN KEY ("transcription_added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_media" ADD CONSTRAINT "scene_media_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentences" ADD CONSTRAINT "sentences_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_segments" ADD CONSTRAINT "transcription_segments_audio_upload_id_audio_uploads_id_fk" FOREIGN KEY ("audio_upload_id") REFERENCES "public"."audio_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_segments" ADD CONSTRAINT "transcription_segments_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_audio_upload_id_audio_uploads_id_fk" FOREIGN KEY ("audio_upload_id") REFERENCES "public"."audio_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_previous_version_transcriptions_id_fk" FOREIGN KEY ("previous_version") REFERENCES "public"."transcriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_sentence_id_sentences_id_fk" FOREIGN KEY ("sentence_id") REFERENCES "public"."sentences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_audio_file_id_audio_files_id_fk" FOREIGN KEY ("audio_file_id") REFERENCES "public"."audio_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_previous_version_translations_id_fk" FOREIGN KEY ("previous_version") REFERENCES "public"."translations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_additional_permissions" ADD CONSTRAINT "user_additional_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_additional_permissions" ADD CONSTRAINT "user_additional_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_additional_permissions" ADD CONSTRAINT "user_additional_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badge_id_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_trigger_contribution_id_contributions_id_fk" FOREIGN KEY ("trigger_contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_recordings" ADD CONSTRAINT "word_recordings_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_recordings" ADD CONSTRAINT "word_recordings_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_recordings" ADD CONSTRAINT "word_recordings_audio_file_id_audio_files_id_fk" FOREIGN KEY ("audio_file_id") REFERENCES "public"."audio_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_recordings" ADD CONSTRAINT "word_recordings_superseded_by_word_recordings_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."word_recordings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_audio_files_uploaded_by" ON "audio_files" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "ix_audio_files_processing_status" ON "audio_files" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX "ix_audio_files_checksum" ON "audio_files" USING btree ("checksum_sha256");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_actor" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_resource" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_created_at" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_concepts_slug_active" ON "concepts" USING btree ("slug") WHERE "concepts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "ix_contributions_user" ON "contributions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_contributions_module_type" ON "contributions" USING btree ("module_type");--> statement-breakpoint
CREATE INDEX "ix_contributions_status" ON "contributions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_contributions_pending_queue" ON "contributions" USING btree ("status","submitted_at") WHERE "contributions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "ix_device_tokens_user" ON "device_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dialects_language_code" ON "dialects" USING btree ("language_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_gamification_config_key_active" ON "gamification_config" USING btree ("config_key") WHERE "gamification_config"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_leaderboard_user_period" ON "leaderboard_snapshots" USING btree ("user_id","period","period_key");--> statement-breakpoint
CREATE INDEX "ix_leaderboard_period_rank" ON "leaderboard_snapshots" USING btree ("period","period_key","rank");--> statement-breakpoint
CREATE INDEX "ix_notifications_user" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_notifications_unread" ON "notifications" USING btree ("user_id","read_at") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "ix_points_transactions_user" ON "points_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_points_transactions_contribution" ON "points_transactions" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "ix_reviews_contribution" ON "reviews" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "ix_reviews_reviewer" ON "reviews" USING btree ("reviewer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_scene_concepts_scene_concept" ON "scene_concepts" USING btree ("scene_id","concept_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_scenes_slug_active" ON "scenes" USING btree ("slug") WHERE "scenes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "ix_sentences_fts" ON "sentences" USING gin (to_tsvector('english', "english_text"));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_badges_user_badge" ON "user_badges" USING btree ("user_id","badge_id");--> statement-breakpoint
CREATE INDEX "ix_user_badges_user" ON "user_badges" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_email_active" ON "users" USING btree ("email") WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_word_recordings_take" ON "word_recordings" USING btree ("contribution_id","concept_id","synonym_index","take_index") WHERE "word_recordings"."deleted_at" is null;