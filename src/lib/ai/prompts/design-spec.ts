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

/* The model chooses WHERE, never WHETHER. resolveLogoPlacement has the final
   say and overrides "none" for a brand that has a logo — but the model has
   just composed the layout, so its own read on which corner is free beats a
   per-layout default, and it needs telling that a logo is coming. */
function logoRule(hasLogo: boolean): string {
  return hasLogo
    ? `\n- This brand has a logo and it WILL be placed on the design. Set "logoPlacement" to the corner your own composition leaves emptiest, so the mark does not land on the headline, the call to action, or the busiest part of the image. Never "none" — the brand has a logo. Do not describe or ask for a logo in "backgroundPrompt" or "nativePrompt"; it is composited separately from the real file.
- "logoFree" is true ONLY if the brief explicitly asks for a design carrying no logo — "no logo", "logo-free", "leave the logo off". It is FALSE when the brief merely mentions the logo, asks for it to be bigger, smaller, recoloured or moved, or insists it be kept ("never omit the logo", "do not remove the logo"). When in doubt, false: the brand's mark belongs on the design.
- "logoFreeQuote" must be the exact words from the brief that asked for no logo, copied character for character from the brief. Empty string when "logoFree" is false. A quote that is not in the brief is treated as no request at all.`
    : `\n- This brand has no logo on file. Set "logoPlacement" to "none", "logoFree" to true, "logoFreeQuote" to "", and do not leave a gap for one.`;
}

export function buildDesignSpecSystemPrompt(
  brand: BrandSummary,
  hasLogo: boolean,
): string {
  return `You are an art director producing a single social media design for ${brand.name}.

Return a structured design spec. Rules that matter:
- Choose "layout" from: ${DESIGN_LAYOUTS.join(", ")}. Pick by the shape of the content, not at random.
- Copy must be short enough to read at a glance on a phone. Headlines are a few words, not a sentence.
- "backgroundPrompt" describes a background image ONLY. It must never ask for text, letters, numbers, words, logos, watermarks, or user interface. The typography is drawn separately and will collide with any lettering the image contains.
- "nativePrompt" is the opposite: it describes the COMPLETE finished design for a model that can render text. Quote the exact copy in double quotes, name the colours, and describe the layout in plain English.
- "palette" must be drawn from the brand colours listed below, as hex values — the primary colour leads unless the brief argues otherwise. A colour given by name rather than as a hex is still the brand's colour: convert it. If no brand colours are listed, choose a palette that fits the brand's visual style. Ensure the foreground reads clearly against the background.${logoRule(hasLogo)}

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
  /* The logo corner needs the same treatment the copy already gets. It was
     omitted, so the plate could put its busiest detail exactly where the mark
     lands and there is no measuring a photograph's luminance after the fact. */
  const logoCorner =
    spec.logoPlacement === "none"
      ? null
      : `Keep the ${spec.logoPlacement.replace("-", " ")} corner plain and low-contrast, with no focal detail, so a logo can sit there and stay legible`;

  return [
    spec.backgroundPrompt.trim().replace(/[.\s]+$/, ""),
    `${treatmentClause(spec.backgroundTreatment)}`,
    `Leave the ${deadZoneFor(spec.layout)} visually calm and uncluttered so typography can sit on top`,
    logoCorner,
    "No text, no letters, no numbers, no words, no logos, no watermarks, no user interface",
  ]
    .filter((clause): clause is string => clause !== null)
    .join(". ");
}

/* The model is never asked to draw the logo, only to leave room for it: the
   real file is composited over its output afterwards, because a model redraws
   a reference rather than reproducing it. Asking for both is how a design ends
   up with two (KOOS-BUG-022).

   "none" used to fall through to the same sentence with the placement
   interpolated raw, so a logo-free design was told to "leave clear space in
   the none corner for a logo". */
function nativeLogoClause(placement: DesignSpec["logoPlacement"]): string {
  if (placement === "none") {
    return "Do not include a logo, wordmark or brand mark anywhere, and do not leave a gap for one.";
  }
  const corner = placement.replace("-", " ");
  return `Leave the ${corner} corner clear and uncluttered for a logo that is added afterwards — no text or busy detail there. Do not draw a logo yourself.`;
}

/** The string sent to a text-capable model for the one-shot native route. */
export function buildNativePrompt(
  spec: DesignSpec,
  brand: BrandSummary,
): string {
  const copy = [
    `Headline: "${spec.headline}"`,
    spec.subheadline ? `Subheadline: "${spec.subheadline}"` : null,
    spec.cta ? `Call to action: "${spec.cta}"` : null,
  ].filter(Boolean);

  return [
    spec.nativePrompt.trim(),
    "",
    "Render this exact copy, spelled correctly:",
    ...copy,
    "",
    `Background colour ${spec.palette.background}, text colour ${spec.palette.foreground}, accent colour ${spec.palette.accent}.`,
    nativeLogoClause(spec.logoPlacement),
    brand.brandStyle
      ? `The brand's visual style is: ${brand.brandStyle}.`
      : null,
    "The text must be sharp, correctly spelled, and legible at small sizes.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
