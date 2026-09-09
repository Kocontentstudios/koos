-- Onboarding now asks about typography, which the brand profile had nowhere to
-- put: there was no font column anywhere in the schema.
--
-- Numbered 0026 rather than 0025 because the welcome-card migration is in
-- flight on its own branch and lands first.
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "brand_font" text;
