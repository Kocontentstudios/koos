ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tour_completed_at" timestamp;
--> statement-breakpoint
-- Grandfather every existing account: anyone already using KO OS has found
-- their way around, and a tour appearing mid-session reads as a bug. Only
-- signups after this deploy see it.
UPDATE "users" SET "tour_completed_at" = now();
