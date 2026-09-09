-- Design Studio can now be given several pieces of existing KOOS content at
-- once (a brief plus a calendar item plus an asset, say). The source enum and
-- the brief_id / calendar_item_id columns each hold one primary reference, so
-- they cannot record what a generation was actually built from.
--
-- Kept as jsonb rather than a join table on purpose: this is a provenance
-- record read back with the generation, never queried across, and the rows it
-- names may be deleted later without invalidating the history.
ALTER TABLE design_generations
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
