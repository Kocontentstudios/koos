ALTER TABLE "design_tickets" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
--> statement-breakpoint
-- Tickets approved before this column existed must keep their download access;
-- updated_at is the closest record of when the client signed off.
UPDATE "design_tickets"
  SET "approved_at" = "updated_at"
  WHERE "status" = 'delivered' AND "approved_at" IS NULL;
