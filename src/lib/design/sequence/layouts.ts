import { DESIGN_LAYOUTS, type DesignSpec } from "@/lib/design/spec";
import {
  sameComposition,
  TEXT_LED_LAYOUTS,
} from "@/lib/jobs/directions/subject-layout";
import type { FrameBeat } from "./contract";

type Layout = DesignSpec["layout"];

/* stat-highlight sets "one figure or short phrase very large" (frame-spec
   LAYOUT_DESCRIPTION), so it needs a figure a reader takes as a stat: an
   amount, a share, or a count. A code ("SS3"), a year, a clock time or a
   phone number is a number but not a stat, and a sentence posing as one
   reads as a slogan in a box. */
const AMOUNT = /[₦$€£]\s?\d|\d\s?%|\b\d[\d,.]*\s?(?:k|m|bn|x)\b/i;
const COUNT = /(?<![\p{L}\d:/+-])\d[\d,.]*(?![\d:/]|\s?(?:am|pm)\b)/giu;
const YEAR = /^(?:19|20)\d\d$/;
const PHONE = /\d{3}[\s-]?\d{3}[\s-]?\d{3,4}/;

export function isStatFigure(text: string): boolean {
  if (AMOUNT.test(text)) return true;
  if (PHONE.test(text)) return false;
  return [...text.matchAll(COUNT)].some((m) => !YEAR.test(m[0]));
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
 *  - A frame without the image is drawn in a text-led layout. With `panel`
 *    (a set with no image at all), split-left is one too: copy in a column
 *    beside an accent panel, the third composition a text-led set needs so
 *    it does not alternate two cards for ten frames. In a set with images
 *    an empty panel reads as a missing picture, so it stays off.
 *  - stat-highlight only on a frame with a figure.
 *  - No frame repeats its neighbour's composition, and where one exists a
 *    frame takes a composition the frame two back did not use either, so
 *    the set cycles rather than alternating. The proposal stands when it
 *    can; otherwise its same-composition twin, then the first fresh
 *    layout, preferring one the brand's recent designs do not hold.
 */
export function settleFrameLayouts(
  frames: readonly LayoutSlot[],
  recent: readonly string[] = [],
  { panel = false }: { panel?: boolean } = {},
): Layout[] {
  const textLed: readonly Layout[] = panel
    ? [...TEXT_LED_LAYOUTS, "split-left"]
    : TEXT_LED_LAYOUTS;
  const settled: Layout[] = [];
  frames.forEach((frame, i) => {
    const allowed = (frame.showsImage ? DESIGN_LAYOUTS : textLed).filter(
      (layout) => layout !== "stat-highlight" || frame.figure === true,
    );
    const before = i > 0 ? settled[i - 1] : null;
    const twoBack = i > 1 ? settled[i - 2] : null;
    const fits = (layout: Layout) =>
      allowed.includes(layout) &&
      (before === null || !sameComposition(before, layout));
    const fresh = (layout: Layout) =>
      fits(layout) && (twoBack === null || layout !== twoBack);
    const cycles = (layout: Layout) =>
      fresh(layout) && (twoBack === null || !sameComposition(twoBack, layout));
    const twin = SAME_COMPOSITION_SWAP[frame.layout];
    const order = [
      frame.layout,
      ...(twin ? [twin] : []),
      ...allowed.filter((l) => !recent.includes(l)),
      ...allowed,
    ];
    const pick =
      order.find(cycles) ?? order.find(fresh) ?? order.find(fits) ?? allowed[0];
    settled.push(pick);
  });
  return settled;
}

/** The frame's layout once its copy is written: a stat-highlight whose
 *  headline gives no stat is set as the centred statement card instead,
 *  which is the same composition, so no neighbour changes. */
export function withFigureLayout(beat: FrameBeat): FrameBeat {
  if (beat.layout !== "stat-highlight" || isStatFigure(beat.headline)) {
    return beat;
  }
  return { ...beat, layout: "quote-card" };
}
