import { mixToward } from "@/lib/design/palette";
import type { DesignElement } from "../schema";
import {
  type Context,
  mostReadableOn,
  NEAR_BLACK,
  px,
  type Rect,
  shapeElement,
  WHITE,
} from "./context";
import type { CopyColors } from "./copy-stack";
import type { Footer } from "./footer";
import { type Veil, veilColor } from "./ground";

/** The share of the canvas, from the top, a cut-out keeps for itself in the
 *  centred layouts; the copy is fitted below it. Fitting the copy first and
 *  giving the subject what was left made a 200px pastry under a 100px
 *  headline. */
export const CUTOUT_SHARE = 0.42;

/** Smaller shares a cut-out may step down to before the copy is laid over
 *  it. A smaller whole subject beside clean copy beats the subject under a
 *  veil with the copy across it, which turned a cream card flat grey on a
 *  square canvas (round-2 renders, quote-card and stat-highlight 1:1). */
export const CUTOUT_SHARES = [CUTOUT_SHARE, 0.36, 0.3] as const;

/** The least height, as a share of the canvas, a cut-out above the copy is
 *  worth drawing at; below it the subject reads as a thumbnail. */
export const MIN_SUBJECT_SHARE = 0.16;

/** Where copy has to end: clear of the footer, or the bottom margin. */
export function copyBottom(ctx: Context, foot: Footer | null): number {
  const clearOfFooter = foot ? foot.top - px(ctx.ref * 0.04) : ctx.height;
  return Math.min(ctx.height - ctx.margin, clearOfFooter);
}

/** Copy colours on the flat brand background. */
export function flatColors(ctx: Context): CopyColors {
  const { palette } = ctx;
  return {
    headline: palette.foreground,
    body: palette.foreground,
    ctaFill: palette.accent,
    ctaLabel: ctaLabelOn(ctx),
    accent: palette.accent,
  };
}

export function ctaLabelOn(ctx: Context): string {
  const { palette } = ctx;
  return mostReadableOn(palette.accent, [
    palette.background,
    palette.foreground,
    WHITE,
    NEAR_BLACK,
  ]);
}

/** Plain footer text on a flat `ground`: whichever brand or neutral colour
 *  reads best there. The flex footer turned white whenever a plate existed,
 *  including where it sat on the cream background. */
export function footerColorOn(ctx: Context, ground: string): string {
  const { palette } = ctx;
  return mostReadableOn(ground, [
    palette.foreground,
    palette.background,
    WHITE,
    NEAR_BLACK,
  ]);
}

/** Headline and subheadline set in `color`; the button, rule and quote mark
 *  keep theirs. */
export function recolorCopy(
  elements: DesignElement[],
  color: string,
  ids: string[] = ["headline", "subheadline"],
): DesignElement[] {
  return elements.map((element) =>
    element.type === "text" && ids.includes(element.id)
      ? { ...element, color }
      : element,
  );
}

/** A colour field in the brand accent, for the half of a split or banner
 *  composition that would hold the photograph. Without it the flex layouts
 *  left that half as bare background and the copy looked misplaced. */
export function accentField(ctx: Context): string {
  const { accent } = ctx.palette;
  return `linear-gradient(160deg, ${accent} 0%, ${mixToward(accent, "#000000", 0.22)} 100%)`;
}

/**
 * A veil over `box` that is clear at its top and reaches the measured alpha
 * just above the copy, holding it to the bottom so everything below the
 * copy's top is covered too. Eased rather than linear: a straight ramp reads
 * as a band across the photo. None at all when the copy reads without one.
 */
export function scrimFor(
  box: Rect,
  copyTop: number,
  veil: Veil,
  radius = 0,
): DesignElement | null {
  if (veil.alpha < 0.02) return null;
  const top = (copyTop - box.y) / box.height;
  const rampStart = Math.max(0, top - 0.24);
  const solid = Math.max(rampStart, top - 0.03);
  const eased = rampStart + (solid - rampStart) * 0.55;
  const at = (alpha: number, share: number) =>
    `${veilColor(veil, alpha)} ${pct(share)}`;
  return shapeElement(
    "scrim",
    "Scrim",
    box,
    `linear-gradient(180deg, ${at(0, 0)}, ${at(0, rampStart)}, ${at(veil.alpha * 0.45, eased)}, ${at(veil.alpha, solid)}, ${at(veil.alpha, 1)})`,
    { radius },
  );
}

function pct(share: number): string {
  return `${Math.round(Math.min(1, Math.max(0, share)) * 1000) / 10}%`;
}
