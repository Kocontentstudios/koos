import type { Canvas } from "@/lib/design/canvas";
import type { DesignSpec } from "@/lib/design/spec";

/**
 * How big the headline can be before the copy stops fitting.
 *
 * Satori cannot shrink text to fit and does not clip, so anything that
 * overflows is simply drawn on top of whatever is beneath it. The old ladder
 * picked a size from the headline's character count alone and had no idea how
 * much vertical room the layout gave it — the same headline got the same size
 * in hero-center, which has the whole canvas, and in banner-bottom, which has
 * a third of it. A short-but-wrapping headline took the largest step and its
 * second line landed on the subheadline (KOOS-BUG-023).
 *
 * Everything here is an estimate, so it is deliberately pessimistic: assuming
 * text is slightly wider than it renders costs a step of headline size,
 * assuming it is narrower costs a design with two lines of copy on top of each
 * other.
 */

/** Mean advance per character, as a fraction of font size. Measured off the
 * bundled faces; the display face is the heavier of the two. */
const DISPLAY_CHAR_WIDTH = 0.58;
const BODY_CHAR_WIDTH = 0.52;

const HEADLINE_LINE_HEIGHT = 1.05;
const BODY_LINE_HEIGHT = 1.35;

/** Font sizes the headline may take, largest first, as fractions of width. */
export const HEADLINE_STEPS = [0.11, 0.095, 0.078, 0.066, 0.058, 0.048, 0.04];

/**
 * Lines the text will occupy, by greedy word wrap over estimated widths.
 *
 * Words matter: "Lagos Launch Week" at a size that fits 16 characters per line
 * wraps after "Launch", not mid-word, so a naive length/perLine underestimates
 * by a line exactly when the headline is short enough to take the biggest
 * step — which is the case that broke.
 */
export function estimateLines(
  text: string,
  fontSize: number,
  maxWidth: number,
  charWidth: number,
): number {
  const perChar = fontSize * charWidth;
  if (perChar <= 0 || maxWidth <= 0) return 1;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;

  let lines = 1;
  let used = 0;
  for (const word of words) {
    const wordWidth = word.length * perChar;
    // A word longer than the line breaks inside itself.
    if (wordWidth > maxWidth) {
      if (used > 0) lines += 1;
      lines += Math.ceil(wordWidth / maxWidth) - 1;
      used = wordWidth % maxWidth;
      continue;
    }
    const spaceWidth = used === 0 ? 0 : perChar;
    if (used + spaceWidth + wordWidth > maxWidth) {
      lines += 1;
      used = wordWidth;
    } else {
      used += spaceWidth + wordWidth;
    }
  }
  return lines;
}

/** The stack's height at a given headline size, matching CopyStack's boxes. */
export function estimateCopyHeight({
  spec,
  headlineSize,
  width,
  maxWidth,
}: {
  spec: Pick<DesignSpec, "headline" | "subheadline" | "cta">;
  headlineSize: number;
  /** Canvas width — the unit CopyStack sizes everything in. */
  width: number;
  /** Room the copy actually has across. */
  maxWidth: number;
}): number {
  /* Every size in the stack is keyed to the SHORTER side, like the padding.
     Keyed to width, a landscape canvas gets body copy and a button sized for
     1344px inside a band 287px tall. */
  const gap = width * 0.028;
  let height =
    estimateLines(spec.headline, headlineSize, maxWidth, DISPLAY_CHAR_WIDTH) *
    headlineSize *
    HEADLINE_LINE_HEIGHT;

  if (spec.subheadline) {
    const size = width * 0.036;
    height +=
      gap +
      estimateLines(spec.subheadline, size, maxWidth, BODY_CHAR_WIDTH) *
        size *
        BODY_LINE_HEIGHT;
  }

  if (spec.cta) {
    // Cta: font 0.032 plus 0.022 padding top and bottom, after its own margin.
    height += gap + width * 0.02 + width * (0.032 * BODY_LINE_HEIGHT + 0.044);
  }

  return height;
}

/**
 * The room each layout leaves the copy, in pixels.
 *
 * Read off the layout bodies: split-left gives the copy a 52% column,
 * banner-bottom a 38% band, the card layouts an inset panel, and hero-center
 * the whole canvas. All four then apply `pad` on every side.
 */
/** The band banner-bottom gives its copy, as a fraction of canvas height. It
 *  grows to fit rather than overflowing — a designer would do the same. */
export const BANNER_BAND = { min: 0.38, max: 0.55 } as const;

export function copySpaceFor(
  layout: DesignSpec["layout"],
  canvas: Canvas,
  /** The band actually used, when the caller has already sized it. */
  bannerBand: number = BANNER_BAND.min,
): { width: number; height: number } {
  const { width, height } = canvas;
  // Must match the layouts' own pad exactly, or this measures a phantom box.
  const pad = Math.min(width, height) * 0.08;

  switch (layout) {
    case "split-left":
      return { width: width * 0.52 - pad * 2, height: height - pad * 2 };
    case "banner-bottom":
      return { width: width - pad * 2, height: height * bannerBand - pad * 2 };
    case "quote-card":
    case "stat-highlight":
      // The panel is inset by pad, and pads its own contents again.
      return { width: width - pad * 4, height: height - pad * 4 };
    default:
      return { width: width - pad * 2, height: height - pad * 2 };
  }
}

/**
 * The largest headline size whose whole stack fits the space.
 *
 * Falls back to the smallest step rather than failing: copy that cannot fit
 * even there is better small than overlapping, and the brief writer is the one
 * who can shorten it.
 */
export function fitHeadlineSize({
  spec,
  layout,
  canvas,
  bannerBand,
}: {
  spec: Pick<DesignSpec, "headline" | "subheadline" | "cta">;
  layout: DesignSpec["layout"];
  canvas: Canvas;
  bannerBand?: number;
}): number {
  const space = copySpaceFor(layout, canvas, bannerBand);
  const reference = Math.min(canvas.width, canvas.height);
  const steps = HEADLINE_STEPS.map((step) => reference * step);

  for (const headlineSize of steps) {
    const needed = estimateCopyHeight({
      spec,
      headlineSize,
      width: reference,
      maxWidth: space.width,
    });
    if (needed <= space.height) return headlineSize;
  }
  return steps[steps.length - 1];
}

/**
 * How tall banner-bottom's copy band has to be.
 *
 * The band was a flat 38% of the canvas, which at 16:9 is 287px — and the
 * padding alone took 120 of those. Growing the band is what a designer does
 * when the copy does not fit the strip they first drew; the plate simply takes
 * what is left.
 */
export function bannerBandFor({
  spec,
  canvas,
}: {
  spec: Pick<DesignSpec, "headline" | "subheadline" | "cta">;
  canvas: Canvas;
}): number {
  const reference = Math.min(canvas.width, canvas.height);
  const pad = reference * 0.08;
  const headlineSize = fitHeadlineSize({
    spec,
    layout: "banner-bottom",
    canvas,
    bannerBand: BANNER_BAND.max,
  });
  const needed =
    estimateCopyHeight({
      spec,
      headlineSize,
      width: reference,
      maxWidth: canvas.width - pad * 2,
    }) +
    pad * 2;

  return Math.min(
    BANNER_BAND.max,
    Math.max(BANNER_BAND.min, needed / canvas.height),
  );
}
