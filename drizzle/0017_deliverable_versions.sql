-- Postgres fills existing rows from the DEFAULT without a table rewrite, so every
-- deliverable uploaded before versioning existed lands in V1.
ALTER TABLE "design_deliverables"
  ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_deliverables_ticket_version_idx"
  ON "design_deliverables" ("ticket_id", "version", "slide_index");
