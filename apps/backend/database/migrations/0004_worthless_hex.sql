CREATE INDEX "ix_audio_uploads_contribution" ON "audio_uploads" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "ix_scene_contributions_contribution" ON "scene_contributions" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "ix_translations_contribution" ON "translations" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "ix_user_stats_total_points" ON "user_stats" USING btree ("total_points");--> statement-breakpoint
CREATE INDEX "ix_user_stats_points_this_week" ON "user_stats" USING btree ("points_this_week");--> statement-breakpoint
CREATE INDEX "ix_word_recordings_concept" ON "word_recordings" USING btree ("concept_id");