CREATE INDEX "ix_contributions_submitted_at" ON "contributions" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "ix_contributions_language" ON "contributions" USING btree ("language_id");--> statement-breakpoint
CREATE INDEX "ix_contributions_dialect" ON "contributions" USING btree ("dialect_id");--> statement-breakpoint
CREATE INDEX "ix_scene_contributions_scene" ON "scene_contributions" USING btree ("scene_id");