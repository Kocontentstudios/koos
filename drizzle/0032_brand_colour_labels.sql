-- Names for a brand's additional colours ("Accent", "Neutral", "CTA").
--
-- A second array rather than migrating additional_colors to jsonb pairs:
-- the values column feeds the render palette, the brand export, the AI
-- extraction chain and the design-request modal, and changing its type would
-- touch every one of those for a feature only the profile form and the
-- display surfaces read.
--
-- Index-aligned with additional_colors. Unnamed slots are stored as an empty
-- string, never collapsed — collapsing would shift every later label onto the
-- wrong swatch. Null means the brand has never named any.
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS additional_color_labels text[];
