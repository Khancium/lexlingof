CREATE TABLE "forum_poll_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum_poll_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forum_poll_options" ADD CONSTRAINT "forum_poll_options_post_id_forum_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_poll_votes" ADD CONSTRAINT "forum_poll_votes_post_id_forum_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_poll_votes" ADD CONSTRAINT "forum_poll_votes_option_id_forum_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."forum_poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_poll_votes" ADD CONSTRAINT "forum_poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_forum_poll_options_post" ON "forum_poll_options" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_forum_poll_votes_post_user" ON "forum_poll_votes" USING btree ("post_id","user_id");--> statement-breakpoint
CREATE INDEX "ix_forum_poll_votes_option" ON "forum_poll_votes" USING btree ("option_id");--> statement-breakpoint
ALTER TABLE "forum_comments" DROP COLUMN "gif_url";--> statement-breakpoint
ALTER TABLE "forum_posts" DROP COLUMN "gif_url";