CREATE TYPE "public"."design_generation_source" AS ENUM('chat_brief', 'calendar_item', 'quick', 'brand');
--> statement-breakpoint
CREATE TYPE "public"."design_renderer" AS ENUM('composite', 'native');
--> statement-breakpoint
CREATE TYPE "public"."design_generation_status" AS ENUM('pending', 'succeeded', 'failed');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS design_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source design_generation_source NOT NULL,
  brief_id uuid REFERENCES design_briefs(id) ON DELETE SET NULL,
  calendar_item_id uuid REFERENCES calendar_items(id) ON DELETE SET NULL,
  design_type text,
  spec jsonb NOT NULL,
  renderer design_renderer NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  image_key text,
  width integer,
  height integer,
  status design_generation_status NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS design_generations_brand_id_idx ON design_generations(brand_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS design_generations_brief_id_idx ON design_generations(brief_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS design_generations_calendar_item_id_idx ON design_generations(calendar_item_id);
--> statement-breakpoint
ALTER TABLE "design_tickets" ADD COLUMN IF NOT EXISTS "reference_image_url" text;
--> statement-breakpoint
ALTER TYPE "public"."usage_kind" ADD VALUE IF NOT EXISTS 'design_generated';
--> statement-breakpoint
ALTER TYPE "public"."generation_job_kind" ADD VALUE IF NOT EXISTS 'design_render';
