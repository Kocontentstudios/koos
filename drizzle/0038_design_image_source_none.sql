-- FEAT-033 round 8: a directions job asked for no image ({ source: "none" },
-- the text-led choice and PR 1's default while FEATURE_KO_IMAGERY is off)
-- records image_source = 'none'. A request with no image field takes the
-- variant path and records NULL, as before. 0037's CHECK allowed only
-- 'upload' and 'ko', so every 'none' row failed to insert. The constraint is replaced, not
-- relaxed: the three values the drizzle schema names, nothing else.
ALTER TABLE "design_generations" DROP CONSTRAINT IF EXISTS "design_generations_image_source_check";
--> statement-breakpoint
ALTER TABLE "design_generations" ADD CONSTRAINT "design_generations_image_source_check" CHECK ("image_source" IN ('upload', 'ko', 'none'));
