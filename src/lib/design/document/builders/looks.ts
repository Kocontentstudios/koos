import { HEADLINE_STEPS } from "@/lib/design/render/copy-fit";
import type { DesignSpec } from "@/lib/design/spec";
import { sizeRange, type TextLook } from "../fit";
import { BUTTON_LINE_HEIGHT } from "../render";

/**
 * Type for every role, as fractions of the canvas's shorter side.
 *
 * The headline takes its size from the flex layouts' own ladder
 * (HEADLINE_STEPS), so a design keeps the same type scale whichever renderer
 * drew it; the measured fit only decides which step the copy reaches.
 */

export const SIZES = {
  subheadline: { size: 0.036, min: 0.027 },
  cta: { size: 0.032, min: 0.024 },
  footer: { size: 0.026, min: 0.019 },
} as const;

/** The smallest type any role is set at, the footer's minimum: a 1080px
 *  design is seen at about a third of its size on a phone, where this is
 *  7px. Below it copy breaks mid-word, with a fault, instead of shrinking. */
export const LEGIBLE_FLOOR = SIZES.footer.min;

export interface HeadlineLimits {
  /** Index into HEADLINE_STEPS of the largest step the layout allows. */
  top: number;
  /** Lines above which a bigger size reads worse than a smaller one. */
  maxLines: number;
}

/* The largest step matches the flex ladder's top step except where the
   layout gives the copy less room: a 52% column, a banner band, a card. */
export const HEADLINE: Record<DesignSpec["layout"], HeadlineLimits> = {
  "hero-center": { top: 0, maxLines: 4 },
  "split-left": { top: 1, maxLines: 5 },
  "banner-bottom": { top: 1, maxLines: 3 },
  "quote-card": { top: 2, maxLines: 5 },
  "stat-highlight": { top: 0, maxLines: 3 },
};

/** Over a photograph the copy shares the frame with the subject, so the
 *  headline stops a step short of filling it. */
export const HERO_OVER_PHOTO: HeadlineLimits = { top: 1, maxLines: 3 };

/** The smallest headline-to-subheadline size ratio that still reads as a
 *  headline. */
export const HIERARCHY = 1.3;

/** Headline sizes in px, largest first, from `limits.top` down the ladder,
 *  none smaller than `floor`. */
export function headlineSizes(
  ref: number,
  limits: HeadlineLimits,
  floor = 0,
): number[] {
  const steps = HEADLINE_STEPS.slice(limits.top)
    .map((step) => Math.round(ref * step))
    .filter((size) => size >= floor);
  return steps.length > 0
    ? steps
    : [Math.round(ref * HEADLINE_STEPS[HEADLINE_STEPS.length - 1])];
}

export function roleSizes(
  ref: number,
  role: keyof typeof SIZES,
  max: number = SIZES[role].size,
): number[] {
  return sizeRange(Math.round(ref * SIZES[role].min), Math.round(ref * max));
}

export const looks = {
  headline: (fontSize: number, align: TextLook["align"]): TextLook => ({
    font: "heading",
    fontSize,
    fontWeight: 700,
    lineHeight: 1.05,
    letterSpacing: -0.01,
    align,
    italic: false,
  }),
  body: (fontSize: number, align: TextLook["align"]): TextLook => ({
    font: "body",
    fontSize,
    fontWeight: 400,
    lineHeight: 1.35,
    letterSpacing: 0,
    align,
    italic: false,
  }),
  footer: (fontSize: number, align: TextLook["align"]): TextLook => ({
    font: "body",
    fontSize,
    fontWeight: 600,
    lineHeight: 1.3,
    letterSpacing: 0.01,
    align,
    italic: false,
  }),
  cta: (fontSize: number): TextLook => ({
    font: "body",
    fontSize,
    fontWeight: 600,
    lineHeight: BUTTON_LINE_HEIGHT,
    letterSpacing: 0,
    align: "center",
    italic: false,
  }),
  quote: (fontSize: number, align: TextLook["align"]): TextLook => ({
    font: "heading",
    fontSize,
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: 0,
    align,
    italic: false,
  }),
};
