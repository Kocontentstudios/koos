/**
 * The brand split into three layers — module 06 §1 of the training manual.
 *
 * The art director was handed the brand's fields and nothing about which of
 * them may move. With no such distinction a model does one of two documented
 * wrong things: repeats one composition forever, or changes everything at once
 * and produces a design that belongs to no brand.
 *
 * - **Fixed anchors** rarely change: the mark, the typefaces, the colour
 *   system, product accuracy, prohibited treatments.
 * - **Controlled variables** may move inside a range: logo corner, light or
 *   dark ground, alignment, crop, texture amount, accent proportion.
 * - **Free campaign elements** should respond to each message: headline, scene,
 *   metaphor, supporting objects, promotional badge.
 *
 * Absent-by-default, the rule brandBlock already follows: a field the brand has
 * not filled in produces no line at all. Describing a typeface a brand does not
 * own makes the model reference something the renderer cannot honour.
 */

export interface AnchorBrand {
  name?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  brandFont?: string | null;
  brandStyle?: string | null;
  tone?: string | null;
}

export interface AnchorContext {
  hasLogo: boolean;
  /** A real font file is on record, so the renderer will draw with it. */
  hasBrandFontFile?: boolean;
}

export interface BrandAnchors {
  fixed: string[];
  controlled: string[];
  free: string[];
}

export function brandAnchors(
  brand: AnchorBrand,
  { hasLogo, hasBrandFontFile = false }: AnchorContext,
): BrandAnchors {
  const fixed: string[] = [];

  if (hasLogo) {
    fixed.push(
      "the logo itself — the real file is composited onto the design, so never describe, redraw, recolour or letter it",
    );
  }
  if (brand.primaryColor || brand.secondaryColor) {
    fixed.push(
      "the brand colour system — the palette comes from these colours, and a design in unrelated colours is not this brand's",
    );
  }
  if (brand.brandFont || hasBrandFontFile) {
    fixed.push(
      `the brand typeface${brand.brandFont ? ` (${brand.brandFont})` : ""} — type is drawn by the renderer in this face, so do not call for another`,
    );
  }
  if (brand.brandStyle) {
    fixed.push(`the established visual style: ${brand.brandStyle}`);
  }
  if (brand.tone) {
    fixed.push(
      `the voice: ${brand.tone} — copy that sounds like another brand fails even when it reads well`,
    );
  }

  /* Module 06 §5's variation matrix, reduced to the dimensions this pipeline
     can actually move. Offering the model a choice the renderer cannot draw
     would be an instruction it must silently ignore. */
  const controlled = [
    hasLogo
      ? "the logo's position — which corner it occupies, among those the layout leaves free"
      : null,
    "a light or dark dominant ground",
    "headline alignment and the layout family",
    "image crop, angle and how much of the frame the subject takes",
    "how much texture and accent colour the design carries",
  ].filter((line): line is string => line !== null);

  const free = [
    "the headline wording",
    "the scene, metaphor and supporting objects",
    "the product action or the moment shown",
    "any seasonal or promotional detail the brief asks for",
  ];

  return { fixed, controlled, free };
}

/**
 * The three layers as a prompt block, with module 06 §4's recognition
 * threshold and §5's closing rule — change two or three dimensions, not all of
 * them. Returns an empty string when the brand carries no anchors at all,
 * rather than a heading over nothing.
 */
export function anchorsBlock(
  brand: AnchorBrand,
  context: AnchorContext,
): string {
  const { fixed, controlled, free } = brandAnchors(brand, context);
  if (fixed.length === 0) return "";

  return [
    "Brand anchors — what must hold, and what you are free to move:",
    `FIXED, do not change: ${fixed.join("; ")}.`,
    `MAY VARY within the brand: ${controlled.join("; ")}.`,
    `FREE to the campaign: ${free.join("; ")}.`,
    "Keep at least one identity anchor, one typographic anchor and one composition anchor so the design is recognisably this brand. Then change two or three of the variable dimensions — not every one at once, which reads as a different brand, and not none, which reads as the same post again.",
  ].join("\n");
}
