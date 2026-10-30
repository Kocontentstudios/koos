-- KOOS-AI-002: one row per carousel or presentation, holding the plan its
-- frames were drawn from (shared palette, logo behaviour, footer system and
-- one beat per frame). A single frame is regenerated against this plan, so
-- the rest of the set is never re-planned; frame i's beat is replaced when
-- frame i is. Frames stay design_generations rows keyed by set_id = id.
CREATE TABLE IF NOT EXISTS "design_sets" (
  "id" uuid PRIMARY KEY NOT NULL,
  "brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "frame_count" integer NOT NULL,
  "plan" jsonb NOT NULL,
  "facts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "offering" text,
  "request" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "design_sets_kind_check" CHECK ("kind" IN ('carousel', 'presentation')),
  CONSTRAINT "design_sets_frame_count_check" CHECK ("frame_count" >= 2)
);
