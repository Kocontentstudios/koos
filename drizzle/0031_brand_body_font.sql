-- A second uploaded font, so a brand can carry the two faces it actually uses.
--
-- brand_font_url already held the ONE uploaded face, and loadBrandFonts
-- substituted it for the Display family — so semantically it has always been
-- the heading font. It keeps its name and its meaning rather than being
-- renamed and backfilled: every existing brand's font stays exactly where it
-- was, doing exactly what it did.
--
-- body_font_url is the new one, substituted for the Body family. Null means
-- "this brand did not upload one", and the bundled Montserrat is used, which
-- is the behaviour every brand has today.
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS body_font_url text;
