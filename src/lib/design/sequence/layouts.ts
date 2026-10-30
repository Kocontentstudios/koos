import { DESIGN_LAYOUTS, type DesignSpec } from "@/lib/design/spec";
import {
  sameComposition,
  TEXT_LED_LAYOUTS,
} from "@/lib/jobs/directions/subject-layout";
import type { FrameBeat } from "./contract";

type Layout = DesignSpec["layout"];

/* stat-highlight sets "one figure or short phrase very large" (frame-spec
   LAYOUT_DESCRIPTION). Round-3 critic: the pitch deck drew "Kiln farmers
   have no access to cold storage" in it, a sentence posing as a figure.
   A figure is a digit, a currency or a percentage, not a number word:
   "One of a kind" is not a stat. */
const FIGURE = /[\d₦$€£%]/;

export function hasFigure(text: string): boolean {
  return FIGURE.test(text);
}

/* The layout drawn in the same composition, for a frame that cannot keep
   the one proposed: swapping within a composition never makes a
   neighbour clash that the proposal did not. */
const SAME_COMPOSITION_SWAP: Partial<Record<Layout, Layout>> = {
  "stat-highlight": "quote-card",
  "quote-card": "stat-highlight",
};

export interface LayoutSlot {
  layout: Layout;
  showsImage: boolean;
  /** Whether the frame has a figure to set large; stat-highlight is only
   *  allowed when it does. */
  figure?: boolean;
}

/**
 * The layout each frame is drawn in, given what the model proposed.
 *
 * Layout is not copy, so code settles it (validateSequence's layout-repeat
 * is the check, this is the fix):
 *  - A frame without the image is drawn in a text-led layout; the others
 *    keep a half or a band for a picture and draw it as an empty panel
 *    (TEXT_LED_LAYOUTS, round-4 live critic).
 *  - stat-highlight only on a frame with a figure.
 *  - No frame repeats its neighbour's composition. The proposal stands when
 *    it can; otherwise its same-composition twin, then a layout neither of
 *    the two frames before it used (so a text-led set cycles hero-center,
 *    quote-card, hero-center, stat-highlight rather than repeating one
 *    pair; round-3 critic, W2), preferring one the brand's recent designs
 *    do not hold, as distinctLayout swaps a direction.
 *
 * Left to right, so each frame only has to avoid the one already settled
 * before it, and a choice always exists: the text-led layouts hold two
 * compositions (hero-center and the centred card).
 */
export function settleFrameLayouts(
  frames: readonly LayoutSlot[],
  recent: readonly string[] = [],
): Layout[] {
  const settled: Layout[] = [];
  frames.forEach((frame, i) => {
    const allowed: readonly Layout[] = (
      frame.showsImage ? DESIGN_LAYOUTS : TEXT_LED_LAYOUTS
    ).filter((layout) => layout !== "stat-highlight" || frame.figure === true);
    const before = i > 0 ? settled[i - 1] : null;
    const twoBack = i > 1 ? settled[i - 2] : null;
    const fits = (layout: Layout) =>
      allowed.includes(layout) &&
      (before === null || !sameComposition(before, layout));
    const twin = SAME_COMPOSITION_SWAP[frame.layout];
    if (fits(frame.layout)) {
      const repeatsTwoBack =
        frame.layout === twoBack && twin !== undefined && fits(twin);
      settled.push(repeatsTwoBack && twin ? twin : frame.layout);
      return;
    }
    if (twin && fits(twin)) {
      settled.push(twin);
      return;
    }
    const free = allowed.filter(fits);
    const fresh = free.filter((layout) => layout !== twoBack);
    const pool = fresh.length > 0 ? fresh : free;
    settled.push(
      pool.find((layout) => !recent.includes(layout)) ?? pool[0] ?? allowed[0],
    );
  });
  return settled;
}

/** The frame's layout once its copy is written: a stat-highlight whose
 *  headline gives no figure is set as the centred statement card instead,
 *  which is the same composition, so no neighbour changes. */
export function withFigureLayout(beat: FrameBeat): FrameBeat {
  if (beat.layout !== "stat-highlight" || hasFigure(beat.headline)) {
    return beat;
  }
  return { ...beat, layout: "quote-card" };
}
