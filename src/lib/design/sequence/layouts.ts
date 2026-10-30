import { DESIGN_LAYOUTS, type DesignSpec } from "@/lib/design/spec";
import {
  sameComposition,
  TEXT_LED_LAYOUTS,
} from "@/lib/jobs/directions/subject-layout";

type Layout = DesignSpec["layout"];

/**
 * The layout each frame is drawn in, given what the model proposed.
 *
 * Layout is not copy, so code settles it (validateSequence's layout-repeat
 * is the check, this is the fix):
 *  - A frame without the image is drawn in a text-led layout; the others
 *    keep a half or a band for a picture and draw it as an empty panel
 *    (TEXT_LED_LAYOUTS, round-4 live critic).
 *  - No frame repeats its neighbour's composition. The proposal stands when
 *    it can; otherwise the first allowed layout in catalogue order that the
 *    brand's recent designs do not hold, as distinctLayout swaps a direction.
 *
 * Left to right, so each frame only has to avoid the one already settled
 * before it, and a choice always exists: the text-led layouts hold two
 * compositions (hero-center and the centred card).
 */
export function settleFrameLayouts(
  frames: readonly { layout: Layout; showsImage: boolean }[],
  recent: readonly string[] = [],
): Layout[] {
  const settled: Layout[] = [];
  frames.forEach((frame, i) => {
    const allowed: readonly Layout[] = frame.showsImage
      ? DESIGN_LAYOUTS
      : TEXT_LED_LAYOUTS;
    const before = i > 0 ? settled[i - 1] : null;
    const fits = (layout: Layout) =>
      allowed.includes(layout) &&
      (before === null || !sameComposition(before, layout));
    if (fits(frame.layout)) {
      settled.push(frame.layout);
      return;
    }
    const free = allowed.filter(fits);
    settled.push(
      free.find((layout) => !recent.includes(layout)) ?? free[0] ?? allowed[0],
    );
  });
  return settled;
}
