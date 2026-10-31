-- KOOS-AI-002 outline step: the outline the user approved before a set was
-- generated, as the server validated it. A frame regenerated later keeps to
-- its approved point and treats the user's own points as stated, so the
-- outline has to outlive the job that planned the set. NULL for a set
-- planned without the outline step.
ALTER TABLE "design_sets" ADD COLUMN IF NOT EXISTS "outline" jsonb;
