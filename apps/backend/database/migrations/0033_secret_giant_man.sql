CREATE INDEX "ix_contributor_demographics_sub_tribe" ON "contributor_demographics" USING btree ("sub_tribe_id");--> statement-breakpoint
CREATE INDEX "ix_contributor_demographics_quarter" ON "contributor_demographics" USING btree ("quarter_id");--> statement-breakpoint
CREATE INDEX "ix_pending_submissions_user_status" ON "pending_submissions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "ix_users_deleted_at_created_at" ON "users" USING btree ("deleted_at","created_at");--> statement-breakpoint
CREATE INDEX "ix_users_role" ON "users" USING btree ("role");