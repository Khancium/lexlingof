CREATE INDEX "ix_contributor_demographics_tribe_city" ON "contributor_demographics" USING btree ("tribe_id","city");--> statement-breakpoint
CREATE INDEX "ix_contributor_demographics_city" ON "contributor_demographics" USING btree ("city");--> statement-breakpoint
CREATE INDEX "ix_contributor_demographics_village" ON "contributor_demographics" USING btree ("village_id");