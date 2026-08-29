ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "welcome_seen_at" timestamp;
--> statement-breakpoint
-- Grandfather every existing account, for the same reason migration 0021 did
-- for the tour: a welcome card appearing to someone already mid-session reads
-- as a bug, not a greeting. Only signups after this deploy see it.
UPDATE "users" SET "welcome_seen_at" = now();
