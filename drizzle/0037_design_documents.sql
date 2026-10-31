-- KOOS-V1-FEAT-033: a generated direction is stored as an editable layer
-- document beside the PNG it rendered to, with the "why this works" list and
-- where its image came from.
--
-- Additive only. Every column is nullable with no default, so existing rows
-- keep document = NULL and render exactly as before, and the bundle still
-- serving during the deploy never names these columns. Safe to apply before
-- the old bundle stops serving.
ALTER TABLE "design_generations" ADD COLUMN IF NOT EXISTS "document" jsonb;
--> statement-breakpoint
ALTER TABLE "design_generations" ADD COLUMN IF NOT EXISTS "rationale" jsonb;
--> statement-breakpoint
-- Inline so the constraint is created with the column and skipped with it on
-- a re-run; ALTER TABLE has no ADD CONSTRAINT IF NOT EXISTS.
ALTER TABLE "design_generations" ADD COLUMN IF NOT EXISTS "image_source" text CHECK ("image_source" IN ('upload', 'ko'));
--> statement-breakpoint
ALTER TABLE "design_generations" ADD COLUMN IF NOT EXISTS "source_image_key" text;
