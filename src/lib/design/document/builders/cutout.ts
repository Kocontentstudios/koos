import {
  drawnImageRect,
  type ImageFacts,
  type ImagePlacement,
  type Rect,
} from "./ground";

/**
 * Where a cut-out subject goes in its frame: whole, never cropped.
 *
 * A cut-out (a product on a transparent background) is the subject itself,
 * plate and shadow included. object-fit: cover crops it to fill the frame,
 * which cut the plate's shadow off with a hard line and pushed the fruit
 * against the top edge (banner-bottom 1:1 and 16:9). Here
 * the image is contained, then zoomed until its visible pixels, not its
 * transparent margin, fill `target`, and centred on them.
 *
 * Zoom 1 always works: a contained image lies inside its frame, so its
 * visible pixels do too. Every larger zoom is kept only when the visible
 * pixels still land inside `target`, so the subject can only ever be
 * smaller than ideal, never cut.
 */
export function containedSubject(
  facts: ImageFacts,
  frame: Rect,
  target: Rect,
): { placement: ImagePlacement; subject: Rect } {
  const { ink } = facts;
  const inkWidth = Math.max(1e-3, ink.right - ink.left);
  const inkHeight = Math.max(1e-3, ink.bottom - ink.top);
  const contained = Math.min(
    frame.width / facts.width,
    frame.height / facts.height,
  );
  const wanted = Math.min(
    target.width / (inkWidth * facts.width),
    target.height / (inkHeight * facts.height),
  );
  /* The schema caps zoom at 10. */
  const ideal = Math.min(10, Math.max(1, wanted / contained));

  for (let zoom = ideal; zoom > 1; zoom -= 0.02) {
    const placement = placementAt(facts, frame, target, round3(zoom));
    const subject = subjectRect(facts, placement);
    if (inside(subject, target)) return { placement, subject };
  }
  const placement = placementAt(facts, frame, target, 1);
  return { placement, subject: subjectRect(facts, placement) };
}

function placementAt(
  facts: ImageFacts,
  frame: Rect,
  target: Rect,
  zoom: number,
): ImagePlacement {
  const { ink } = facts;
  const scale =
    Math.min(frame.width / facts.width, frame.height / facts.height) * zoom;
  /* Solve (frame - drawn) * focus + ink centre = target centre. An image
     exactly as big as its frame on an axis has no freedom on it. */
  const focus = (
    frameStart: number,
    frameSize: number,
    drawn: number,
    inkCentre: number,
    targetCentre: number,
  ) => {
    const free = frameSize - drawn;
    if (Math.abs(free) < 0.5) return 0.5;
    const value = (targetCentre - frameStart - inkCentre * drawn) / free;
    return round3(Math.min(1, Math.max(0, value)));
  };
  return {
    frame,
    fit: "contain",
    zoom,
    focusX: focus(
      frame.x,
      frame.width,
      facts.width * scale,
      (ink.left + ink.right) / 2,
      target.x + target.width / 2,
    ),
    focusY: focus(
      frame.y,
      frame.height,
      facts.height * scale,
      (ink.top + ink.bottom) / 2,
      target.y + target.height / 2,
    ),
  };
}

/** The canvas rectangle the image's visible pixels occupy. */
export function subjectRect(
  facts: ImageFacts,
  placement: ImagePlacement,
): Rect {
  const drawn = drawnImageRect(facts, placement);
  return {
    x: drawn.x + facts.ink.left * drawn.width,
    y: drawn.y + facts.ink.top * drawn.height,
    width: (facts.ink.right - facts.ink.left) * drawn.width,
    height: (facts.ink.bottom - facts.ink.top) * drawn.height,
  };
}

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
