ALTER TYPE "design_ticket_status" ADD VALUE IF NOT EXISTS 'draft';
--> statement-breakpoint
ALTER TABLE "design_tickets" ADD COLUMN IF NOT EXISTS "title" text;
--> statement-breakpoint
ALTER TABLE "design_tickets" ADD COLUMN IF NOT EXISTS "specs" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "design_ticket_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" uuid NOT NULL REFERENCES "design_tickets"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "category" text NOT NULL DEFAULT 'asset',
  "file_key" text,
  "file_name" text,
  "mime_type" text,
  "size_bytes" integer,
  "url" text,
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_ticket_attachments_ticket_idx"
  ON "design_ticket_attachments" ("ticket_id");
