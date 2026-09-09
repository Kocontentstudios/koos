-- FEAT-012 shipped typography as a named style. This is the uploaded face
-- itself, so designs can render in the brand's own typeface rather than one of
-- the three families vendored with the renderer.
--
-- Stored as a URL on the brand rather than a brand_assets row: the renderer
-- needs exactly one file per brand and looks it up by brand, not by asset id.
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "brand_font_url" text;
