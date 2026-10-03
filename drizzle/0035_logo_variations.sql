-- KOOS-V1-FEAT-032: a brand has one logo URL, so a second file overwrote the
-- first. Brands routinely hold a stacked mark, a horizontal lockup, an icon,
-- and light/dark cuts of each, and a design that puts a dark wordmark on a
-- dark plate is only fixable today by drawing a panel behind it.
--
-- Extends brand_assets rather than adding a table: it already stores extra
-- logos (asset_type = 'logo') and already feeds design generation, so this
-- labels what is there instead of migrating it somewhere else.
--
-- Every column is nullable or defaulted, and nothing the running bundle names
-- is removed, so this is safe in a single deploy. Logos already uploaded
-- become unlabelled variations usable on any background, which is exactly
-- what they are today.
CREATE TYPE "public"."logo_variant" AS ENUM('primary', 'horizontal', 'vertical', 'icon', 'wordmark', 'alternate');
--> statement-breakpoint
CREATE TYPE "public"."logo_background" AS ENUM('any', 'light', 'dark');
--> statement-breakpoint
ALTER TABLE "brand_assets" ADD COLUMN IF NOT EXISTS "logo_variant" "logo_variant";
--> statement-breakpoint
ALTER TABLE "brand_assets" ADD COLUMN IF NOT EXISTS "logo_background" "logo_background" NOT NULL DEFAULT 'any';
--> statement-breakpoint
-- What the user calls it ("Icon — dark backgrounds"). Free text on purpose:
-- the variant enum is for the renderer, the label is for the human.
ALTER TABLE "brand_assets" ADD COLUMN IF NOT EXISTS "label" text;
--> statement-breakpoint
-- The brand's default mark. brands.logo_url stays the source of truth for the
-- primary logo, so this marks a VARIATION as the preferred one to reach for;
-- a partial unique index keeps two rows from both claiming it.
ALTER TABLE "brand_assets" ADD COLUMN IF NOT EXISTS "is_preferred" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_assets_one_preferred_logo"
  ON "brand_assets" ("brand_id")
  WHERE "asset_type" = 'logo' AND "is_preferred";
