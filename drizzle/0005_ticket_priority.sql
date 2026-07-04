CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
ALTER TABLE "design_tickets" ADD COLUMN "priority" "ticket_priority" DEFAULT 'normal' NOT NULL;
