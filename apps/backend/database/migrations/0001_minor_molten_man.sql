CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'other', 'prefer_not_to_say');--> statement-breakpoint
CREATE TABLE "contributor_demographics" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"age" integer NOT NULL,
	"gender" "gender" NOT NULL,
	"mother_tongue" text NOT NULL,
	"tribe_id" uuid NOT NULL,
	"sub_tribe_id" uuid,
	"country" text NOT NULL,
	"city" text NOT NULL,
	"village_id" uuid NOT NULL,
	"quarter_id" uuid,
	"dialect" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"village_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_tribes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tribe_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tribes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tribes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "villages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"city" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contributor_demographics" ADD CONSTRAINT "contributor_demographics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_demographics" ADD CONSTRAINT "contributor_demographics_tribe_id_tribes_id_fk" FOREIGN KEY ("tribe_id") REFERENCES "public"."tribes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_demographics" ADD CONSTRAINT "contributor_demographics_sub_tribe_id_sub_tribes_id_fk" FOREIGN KEY ("sub_tribe_id") REFERENCES "public"."sub_tribes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_demographics" ADD CONSTRAINT "contributor_demographics_village_id_villages_id_fk" FOREIGN KEY ("village_id") REFERENCES "public"."villages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_demographics" ADD CONSTRAINT "contributor_demographics_quarter_id_quarters_id_fk" FOREIGN KEY ("quarter_id") REFERENCES "public"."quarters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarters" ADD CONSTRAINT "quarters_village_id_villages_id_fk" FOREIGN KEY ("village_id") REFERENCES "public"."villages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_tribes" ADD CONSTRAINT "sub_tribes_tribe_id_tribes_id_fk" FOREIGN KEY ("tribe_id") REFERENCES "public"."tribes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quarters_village_id_name_key" ON "quarters" USING btree ("village_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_tribes_tribe_id_name_key" ON "sub_tribes" USING btree ("tribe_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "villages_country_city_name_key" ON "villages" USING btree ("country","city","name");