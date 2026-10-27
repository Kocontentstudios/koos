-- FEAT-033 round 8: a two-direction job with no image ({ source: "none" },
-- and every request while FEATURE_KO_IMAGERY is off and no photo is chosen)
-- records image_source = 'none'. 0037's CHECK allowed only 'upload' and 'ko',
-- so every such row failed to insert. The constraint is replaced, not
-- relaxed: the three values the drizzle schema names, nothing else.
ALTER TABLE "design_generations" DROP CONSTRAINT IF EXISTS "design_generations_image_source_check";
--> statement-breakpoint
ALTER TABLE "design_generations" ADD CONSTRAINT "design_generations_image_source_check" CHECK ("image_source" IN ('upload', 'ko', 'none'));
