-- Revert local-disk audio staging back to a DB-buffered (bytea) column.
-- Local disk doesn't survive a Railway redeploy, which was failing
-- in-flight submissions; any row still referencing audio_file_path is
-- already unrecoverable (its staged file is gone), so this is a clean
-- drop-and-add rather than a data migration.
ALTER TABLE "pending_submissions" DROP COLUMN "audio_file_path";--> statement-breakpoint
ALTER TABLE "pending_submissions" ADD COLUMN "audio_buffer" bytea;
