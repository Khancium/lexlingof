CREATE TABLE "contribution_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "sub_tribes_tribe_id_name_key";--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "remarks" text;--> statement-breakpoint
ALTER TABLE "sub_tribes" ADD COLUMN "parent_sub_tribe_id" uuid;--> statement-breakpoint
ALTER TABLE "contribution_keywords" ADD CONSTRAINT "contribution_keywords_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contribution_keywords_contribution_keyword" ON "contribution_keywords" USING btree ("contribution_id","keyword");--> statement-breakpoint
CREATE INDEX "ix_contribution_keywords_contribution" ON "contribution_keywords" USING btree ("contribution_id");--> statement-breakpoint
ALTER TABLE "sub_tribes" ADD CONSTRAINT "sub_tribes_parent_sub_tribe_id_sub_tribes_id_fk" FOREIGN KEY ("parent_sub_tribe_id") REFERENCES "public"."sub_tribes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sub_tribes_tribe_id_parent_name_key" ON "sub_tribes" USING btree ("tribe_id","parent_sub_tribe_id","name");--> statement-breakpoint
ALTER TABLE "contribution_keywords" ENABLE ROW LEVEL SECURITY;