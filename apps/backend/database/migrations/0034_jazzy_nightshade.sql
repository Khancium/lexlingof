CREATE TYPE "public"."forum_reaction_type" AS ENUM('like', 'dislike', 'laugh', 'love', 'wow', 'sad', 'angry');--> statement-breakpoint
CREATE TABLE "forum_comment_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction_type" "forum_reaction_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"body" text NOT NULL,
	"gif_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "forum_post_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction_type" "forum_reaction_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"image_url" text,
	"image_storage_key" text,
	"gif_url" text,
	"concept_id" uuid,
	"sentence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "forum_comment_reactions" ADD CONSTRAINT "forum_comment_reactions_comment_id_forum_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."forum_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_comment_reactions" ADD CONSTRAINT "forum_comment_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_comments" ADD CONSTRAINT "forum_comments_post_id_forum_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_comments" ADD CONSTRAINT "forum_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_comments" ADD CONSTRAINT "forum_comments_parent_comment_id_forum_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."forum_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post_reactions" ADD CONSTRAINT "forum_post_reactions_post_id_forum_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post_reactions" ADD CONSTRAINT "forum_post_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_sentence_id_sentences_id_fk" FOREIGN KEY ("sentence_id") REFERENCES "public"."sentences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_forum_comment_reactions_comment_user" ON "forum_comment_reactions" USING btree ("comment_id","user_id");--> statement-breakpoint
CREATE INDEX "ix_forum_comment_reactions_comment" ON "forum_comment_reactions" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "ix_forum_comments_post" ON "forum_comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "ix_forum_comments_parent" ON "forum_comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_forum_post_reactions_post_user" ON "forum_post_reactions" USING btree ("post_id","user_id");--> statement-breakpoint
CREATE INDEX "ix_forum_post_reactions_post" ON "forum_post_reactions" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "ix_forum_posts_created_at" ON "forum_posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_forum_posts_author" ON "forum_posts" USING btree ("author_id");