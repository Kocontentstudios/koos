import type { DesignSpec } from "@/lib/design/spec";
import type { FrameBeat, PlannedSequence } from "./contract";

/* What each layout looks like, for the native route's prompt: the same
   words the art director's layout list would use, so a text-capable model
   draws the composition the composite renderer would. */
const LAYOUT_DESCRIPTION: Record<DesignSpec["layout"], string> = {
  "hero-center":
    "a centred stack: headline in the middle, supporting line below it",
  "split-left":
    "copy in the left half, the image filling the right half to the edge",
  "banner-bottom":
    "the image filling the frame, copy on a band across the lower third",
  "quote-card": "one statement set large on a centred card, generous margins",
  "stat-highlight":
    "one figure or short phrase set very large, a short line under it",
};

const ROLE_JOB: Record<FrameBeat["role"], string> = {
  hook: "the opening frame, which has to earn the swipe",
  body: "a middle frame carrying one point",
  cta: "the closing frame, which carries the action",
};

/* A frame with no scene of its own still needs a ground the plate model can
   paint and the composite can fall back on. It describes texture and colour
   only, never copy, so nothing on it competes with the type. */
function neutralGround(palette: DesignSpec["palette"]): string {
  return `A calm, even ${palette.background} ground with a fine paper grain and soft natural light, no objects`;
}

/** The set's footer system as one frame draws it. A frame with nothing to
 *  put in it draws none, since an empty band reads as a mistake; lines
 *  under a plan that chose none are still drawn as text, because those
 *  lines are where a frame states the brief's facts. */
export function footerStyleFor(
  plan: Pick<PlannedSequence, "footerStyle">,
  footerLines: readonly string[],
): DesignSpec["footerStyle"] {
  if (footerLines.length === 0) return "none";
  return plan.footerStyle === "none" ? "text" : plan.footerStyle;
}

function nativePromptFor(
  plan: PlannedSequence,
  beat: FrameBeat,
  index: number,
): string {
  const noun = plan.kind === "presentation" ? "slide" : "frame";
  return [
    `${noun === "slide" ? "Slide" : "Frame"} ${index + 1} of ${plan.frames.length} of a ${plan.kind}: ${ROLE_JOB[beat.role]}, about ${beat.title.trim() || "the offer"}.`,
    `Layout: ${LAYOUT_DESCRIPTION[beat.layout]}.`,
    beat.showsImage
      ? "Built around the set's image."
      : "Text-led: type, colour and space carry it, with no photograph.",
    `It shares one type system, palette (background ${plan.palette.background}, text ${plan.palette.foreground}, accent ${plan.palette.accent}), logo position and footer with every other ${noun} of the set; only the composition changes.`,
  ].join(" ");
}

/** One frame of a plan as the ordinary single-frame spec the renderer draws,
 *  with the set's shared palette, logo and footer system. Pure. */
export function frameSpec(plan: PlannedSequence, index: number): DesignSpec {
  const beat = plan.frames[index];
  if (!beat) {
    throw new RangeError(
      `frameSpec: frame ${index} is outside a ${plan.frames.length}-frame set`,
    );
  }
  const isCta = beat.role === "cta";
  const subheadline = beat.subheadline.trim();
  const cta = isCta ? beat.cta.trim() : "";
  const footerLines = beat.footerLines.filter((line) => line.trim());
  return {
    layout: beat.layout,
    headline: beat.headline,
    ...(subheadline ? { subheadline: beat.subheadline } : {}),
    ...(cta ? { cta: beat.cta } : {}),
    footerStyle: footerStyleFor(plan, footerLines),
    footerLines,
    palette: { ...plan.palette },
    logoPlacement: plan.logoPlacement,
    logoFree: plan.logoFree,
    logoFreeQuote: plan.logoFreeQuote,
    backgroundPrompt:
      beat.backgroundPrompt.trim() || neutralGround(plan.palette),
    backgroundTreatment: plan.backgroundTreatment,
    nativePrompt: nativePromptFor(plan, beat, index),
    aspectRatio: plan.aspectRatio,
  };
}
