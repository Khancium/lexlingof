-- Hand-written, same shape as 0015_enable_rls_all_tables.sql.
--
-- 0015 (and 0017) enabled Row Level Security on every table that existed at the
-- time -- 46 tables. These 12 were created afterwards (forum, password reset,
-- terms acceptance, volunteer approval queue, suggestions, publishing) and were
-- never covered, so they were the only tables in the schema without it.
--
-- Same posture as 0015: RLS is enabled with NO policies. The backend connects
-- with a role that owns the tables, so it is unaffected; what this closes is
-- access through Supabase's auto-generated Data API (PostgREST) using the
-- public anon/authenticated keys, which would otherwise be able to read or
-- write these tables -- including password_reset_tokens (token hashes).
--
-- ENABLE ROW LEVEL SECURITY is idempotent, so re-running this is harmless.
ALTER TABLE "public"."forum_posts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."forum_comments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."forum_post_reactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."forum_comment_reactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."forum_poll_options" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."forum_poll_votes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."password_reset_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."terms_acceptances" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."pending_changes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."suggestions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."published_word_recordings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."published_translations" ENABLE ROW LEVEL SECURITY;
