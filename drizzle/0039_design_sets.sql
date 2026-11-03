-- KOOS-AI-002: a carousel or presentation is one set of frames, one
-- design_generations row per frame. set_id groups them; frame_index orders
-- them; frame_count is the size the set was asked for, so a set missing a
-- failed frame still knows it is short. A regenerated frame is a new row with
-- the same set_id and frame_index; the row it replaced points at it through
-- superseded_by, so the set always reads as its live frames plus history.
-- Rows from before this migration keep NULL and render as single designs.
ALTER TABLE "design_generations" ADD COLUMN IF NOT EXISTS "set_id" uuid;
--> statement-breakpoint
ALTER TABLE "design_generations" ADD COLUMN IF NOT EXISTS "frame_index" integer;
--> statement-breakpoint
ALTER TABLE "design_generations" ADD COLUMN IF NOT EXISTS "frame_count" integer;
--> statement-breakpoint
ALTER TABLE "design_generations" ADD COLUMN IF NOT EXISTS "superseded_by" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_generations_set_id_index" ON "design_generations" ("set_id");
--> statement-breakpoint
ALTER TABLE "design_generations" DROP CONSTRAINT IF EXISTS "design_generations_frame_check";
--> statement-breakpoint
ALTER TABLE "design_generations" ADD CONSTRAINT "design_generations_frame_check" CHECK (
  ("set_id" IS NULL AND "frame_index" IS NULL AND "frame_count" IS NULL)
  OR ("set_id" IS NOT NULL AND "frame_index" >= 0 AND "frame_count" >= 2 AND "frame_index" < "frame_count")
);
