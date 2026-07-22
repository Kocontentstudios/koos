CREATE TABLE "design_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"design_type" text NOT NULL,
	"dimensions" text,
	"slides" integer,
	"brief_markdown" text NOT NULL,
	"notes" text,
	"ticket_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_briefs" ADD CONSTRAINT "design_briefs_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "design_briefs" ADD CONSTRAINT "design_briefs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "design_briefs" ADD CONSTRAINT "design_briefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "design_briefs" ADD CONSTRAINT "design_briefs_ticket_id_design_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."design_tickets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "design_briefs_conversation_id_idx" ON "design_briefs" ("conversation_id");
