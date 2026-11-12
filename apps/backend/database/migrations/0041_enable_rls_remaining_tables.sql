-- Hand-written, same shape as 0015_enable_rls_all_tables.sql.
--
-- 0015 (and 0017) enabled Row Level Security on every table that existed at the
-- time -- 46 tables. These 12 were created afterwards (forum, password reset,
-- terms acceptance, volunteer approval queue, suggestions, publishing) and no
-- migration ever covered them.
--
-- As of 2026-11-12 the production database ALREADY has RLS enabled on all 12
-- (checked directly: 58 of 58 public tables) -- it was turned on outside the
-- migration history, most likely from the Supabase dashboard. So against
-- production this migration is a no-op; it exists so the migration history
-- matches reality, and a database built purely from migrations (e.g. a future
-- staging database) gets the same protection instead of silently lacking it.
--
-- Same posture as 0015: RLS enabled with NO policies. The backend connects as a
-- role that bypasses RLS, so it is unaffected; what this protects against is
-- access through Supabase's auto-generated Data API (PostgREST) with the public
-- anon/authenticated keys -- including password_reset_tokens (token hashes).
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
