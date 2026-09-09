import { MAX_ADDITIONAL_COLORS } from "@/lib/brand-profile";
import type { DesignContext } from "@/lib/design/context";
import { DESIGN_LAYOUTS, type DesignSpec } from "@/lib/design/spec";
import { type BrandSummary, brandBlock } from "./strategy";

/**
 * The brand's saved colours, most important first.
 *
 * Values pass through verbatim rather than via normalizeHex: the
 * conversational onboarding path legitimately stores names ("forest green"),
 * and a name still steers the art director, which answers with a real hex in
 * `palette`. Hex-filtering here would drop exactly what that path produces.
 * Sliced defensively — additional_colors is a bare text[] with no DB cap.
 */
export function brandPalette(b: BrandSummary): string {
  const colors = [
    b.primaryColor,
    b.secondaryColor,
    ...(b.additionalColors ?? []).slice(0, MAX_ADDITIONAL_COLORS),
  ]
    .map((c) => c?.trim())
    .filter((c): c is string => !!c);
  return colors.length === 0
    ? ""
    : `\nBrand colours, most important first: ${colors.join(", ")}`;
}

/** Keeps typography clear of the busiest part of the plate, per layout. */
function deadZoneFor(layout: DesignSpec["layout"]): string {
  switch (layout) {
    case "banner-bottom":
      return "lower third";
    case "split-left":
      return "left half";
    case "stat-highlight":
    case "quote-card":
      return "centre";
    default:
      return "centre and lower third";
  }
}

function treatmentClause(treatment: DesignSpec["backgroundTreatment"]): string {
  switch (treatment) {
    case "photographic":
      return "Photographic, natural lighting, shallow depth of field";
    case "illustration":
      return "Flat vector illustration, clean shapes";
    case "gradient":
      return "Smooth colour gradient, no imagery";
    case "pattern":
      return "Subtle geometric pattern, low contrast";
    default:
      return "Flat solid colour field";
  }
}

export function buildDesignSpecSystemPrompt(brand: BrandSummary): string {
  return `You are an art director producing a single social media design for ${brand.name}.

Return a structured design spec. Rules that matter:
- Choose "layout" from: ${DESIGN_LAYOUTS.join(", ")}. Pick by the shape of the content, not at random.
- Copy must be short enough to read at a glance on a phone. Headlines are a few words, not a sentence.
- "backgroundPrompt" describes a background image ONLY. It must never ask for text, letters, numbers, words, logos, watermarks, or user interface. The typography is drawn separately and will collide with any lettering the image contains.
- "nativePrompt" is the opposite: it describes the COMPLETE finished design for a model that can render text. Quote the exact copy in double quotes, name the colours, and describe the layout in plain English.
- "palette" must be drawn from the brand colours listed below, as hex values — the primary colour leads unless the brief argues otherwise. A colour given by name rather than as a hex is still the brand's colour: convert it. If no brand colours are listed, choose a palette that fits the brand's visual style. Ensure the foreground reads clearly against the background.

${brandBlock(brand)}${brandPalette(brand)}`;
}

export function buildDesignSpecPrompt(context: DesignContext): string {
  const lines = [
    context.title ? `Title: ${context.title}` : null,
    context.designType ? `Design type: ${context.designType}` : null,
    context.dimensions ? `Dimensions: ${context.dimensions}` : null,
    context.platform ? `Platform: ${context.platform}` : null,
    context.scheduledFor ? `Scheduled for: ${context.scheduledFor}` : null,
    `Target aspect ratio: ${context.aspectRatio}`,
  ].filter(Boolean);

  const request =
    context.briefText?.trim() ||
    "Produce an on-brand social post that reflects the brand's offer and goal.";

  return `Design request:\n${lines.join("\n")}\n\nBrief:\n${request}`;
}

/** The string actually sent to the plate model. The negative clause is what
 * keeps garbled lettering out of the background the overlay sits on. */
export function buildBackgroundPlatePrompt(spec: DesignSpec): string {
  return [
    spec.backgroundPrompt.trim().replace(/[.\s]+$/, ""),
    `${treatmentClause(spec.backgroundTreatment)}`,
    `Leave the ${deadZoneFor(spec.layout)} visually calm and uncluttered so typography can sit on top`,
    "No text, no letters, no numbers, no words, no logos, no watermarks, no user interface",
  ].join(". ");
}

/** The string sent to a text-capable model for the one-shot native route. */
export function buildNativePrompt(
  spec: DesignSpec,
  brand: BrandSummary,
  hasLogoReference: boolean,
): string {
  const copy = [
    `Headline: "${spec.headline}"`,
    spec.subheadline ? `Subheadline: "${spec.subheadline}"` : null,
    spec.cta ? `Call to action: "${spec.cta}"` : null,
  ].filter(Boolean);

  const logoClause = hasLogoReference
    ? "Place the supplied logo image, unmodified and unstretched, in the " +
      `${spec.logoPlacement.replace("-", " ")} corner.`
    : brand.brandStyle
      ? `Leave clear space in the ${spec.logoPlacement.replace("-", " ")} corner for a logo. The brand's visual style is: ${brand.brandStyle}.`
      : `Leave clear space in the ${spec.logoPlacement.replace("-", " ")} corner for a logo.`;

  return [
    spec.nativePrompt.trim(),
    "",
    "Render this exact copy, spelled correctly:",
    ...copy,
    "",
    `Background colour ${spec.palette.background}, text colour ${spec.palette.foreground}, accent colour ${spec.palette.accent}.`,
    logoClause,
    "The text must be sharp, correctly spelled, and legible at small sizes.",
  ].join("\n");
}
