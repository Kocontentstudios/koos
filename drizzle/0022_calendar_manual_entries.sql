CREATE TYPE "calendar_item_source" AS ENUM ('ai', 'manual');
--> statement-breakpoint
-- Every row that exists today came out of calendar generation, so the default
-- doubles as the backfill for existing calendars.
ALTER TABLE "calendar_items" ADD COLUMN IF NOT EXISTS "source" "calendar_item_source" NOT NULL DEFAULT 'ai';
--> statement-breakpoint
ALTER TABLE "calendar_items" ADD COLUMN IF NOT EXISTS "caption" text;
--> statement-breakpoint
ALTER TABLE "calendar_items" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
-- Every ownership check and every day render fans out from calendar_id; the
-- table has carried no index on it since 0000.
CREATE INDEX IF NOT EXISTS "calendar_items_calendar_id_index" ON "calendar_items" ("calendar_id");
