CREATE TYPE "public"."conversation_mode" AS ENUM('strategy', 'design');
--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "mode" "conversation_mode" NOT NULL DEFAULT 'strategy';
--> statement-breakpoint
ALTER TYPE "public"."generation_job_kind" ADD VALUE IF NOT EXISTS 'design_brief';
