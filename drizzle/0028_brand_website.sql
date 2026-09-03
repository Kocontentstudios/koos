-- KOS-V1-FEAT-017: the onboarding chat asks for a website, and the calendar
-- generator wants it as a first-class field rather than buried in the
-- comma-separated helpful_links free text.
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "website_url" text;
