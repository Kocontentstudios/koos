CREATE SEQUENCE "public"."design_ticket_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_tickets" ALTER COLUMN "ticket_number" SET DEFAULT nextval('design_ticket_number_seq');--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "values" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "words_love" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "words_avoid" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "has_logo" boolean;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "brand_style" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "competitors" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "competitor_strengths" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "differentiators" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "platforms" text[];--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "primary_platform" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "posting_frequency" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "additional_notes" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "helpful_links" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;