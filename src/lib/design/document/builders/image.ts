import type { ImageElement } from "../schema";
import {
  type Context,
  imageElement,
  NEAR_BLACK,
  overlaps,
  px,
  type Rect,
  rect,
  WHITE,
} from "./context";
import { containedSubject } from "./cutout";
import {
  bestVeil,
  contrastOn,
  groundSamples,
  hexToRgb,
  type ImagePlacement,
  type Rgb,
  UNKNOWN_GROUND,
  type Veil,
} from "./ground";

/**
 * The image element for a frame, and the veil copy over it needs.
 *
 * A photograph fills its frame (cover). A cut-out is contained and sized to
 * `target` by its visible pixels (cutout.ts), so the subject and its shadow
 * are always whole.
 */

export function isCutout(ctx: Context): boolean {
  return Boolean(ctx.image && ctx.imageFacts?.cutout);
}

/** How far a cut-out subject stays inside its frame on each side. */
export interface SubjectInsets {
  top: number;
  bottom: number;
  sides: number;
}

export function framedImage(
  ctx: Context,
  frame: Rect,
  insets?: SubjectInsets,
): { element: ImageElement; placement: ImagePlacement } | null {
  if (!ctx.image) return null;
  const facts = ctx.imageFacts;
  const placement: ImagePlacement = facts?.cutout
    ? subjectPlacement(ctx, frame, insets)
    : { frame, fit: "cover", zoom: 1, focusX: 0.5, focusY: 0.5 };
  return { element: imageElement(ctx.image, frame, placement), placement };
}

/**
 * A cut-out sized to the frame less its insets, kept clear of the logo.
 *
 * The subject is centred, so it usually misses a corner mark on its own.
 * Only when it would not is it fitted to the room below the mark instead,
 * as long as that room is not much smaller; otherwise the subject may pass
 * behind the mark, whose backing the rasterizer measures on the result.
 */
function subjectPlacement(
  ctx: Context,
  frame: Rect,
  insets: SubjectInsets = {
    top: ctx.margin,
    bottom: ctx.margin,
    sides: ctx.margin,
  },
): ImagePlacement {
  const facts = ctx.imageFacts as NonNullable<Context["imageFacts"]>;
  const target = rect(
    frame.x + insets.sides,
    frame.y + insets.top,
    frame.width - insets.sides * 2,
    frame.height - insets.top - insets.bottom,
  );
  const first = containedSubject(facts, frame, target);
  const box = ctx.logoBox;
  const gap = px(ctx.ref * 0.03);
  if (!box || !overlaps(box, first.subject, gap)) return first.placement;
  const below = box.y + box.height + gap;
  const cleared = rect(
    target.x,
    Math.max(target.y, below),
    target.width,
    target.y + target.height - Math.max(target.y, below),
  );
  if (cleared.height < target.height * 0.55) return first.placement;
  return containedSubject(facts, frame, cleared).placement;
}

export const COPY_CANDIDATES = (ctx: Context) => [
  WHITE,
  ctx.palette.foreground,
  NEAR_BLACK,
];

/** What the reader sees in `region`, from the measured image when there is
 *  one. Without facts, the worst ground: white and black both. */
export function samplesUnder(
  ctx: Context,
  placement: ImagePlacement | null,
  region: Rect,
  background: string,
): Rgb[] {
  if (!ctx.imageFacts || !placement) return UNKNOWN_GROUND;
  return groundSamples(ctx.imageFacts, placement, region, background);
}

export function veilFor(
  ctx: Context,
  placement: ImagePlacement | null,
  region: Rect,
  background: string,
): Veil {
  return bestVeil(
    samplesUnder(ctx, placement, region, background),
    COPY_CANDIDATES(ctx),
  );
}

/** `samples` as seen through `alpha` of a veil in `veil.color`. */
export function veiled(
  samples: Rgb[],
  veil: { color: string },
  alpha: number,
): Rgb[] {
  const target = hexToRgb(veil.color);
  return samples.map(
    (sample) => sample.map((c, i) => c + (target[i] - c) * alpha) as Rgb,
  );
}

/**
 * The accent where it clears 3:1 on every pixel of `ground` (WCAG for
 * display-size type, which a stat, a quote mark and a rule all are);
 * otherwise `fallback`, the copy's own colour. Judged per pixel, not on an
 * average: an orange mark over a veiled checkerboard averaged fine and was
 * lost on half its squares.
 */
export function accentOn(ctx: Context, ground: Rgb[], fallback: string) {
  return ground.every((pixel) => contrastOn(ctx.palette.accent, pixel) >= 3)
    ? ctx.palette.accent
    : fallback;
}
