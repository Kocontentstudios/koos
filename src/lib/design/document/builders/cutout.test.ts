import { describe, expect, it } from "vitest";
import { containedSubject, subjectRect } from "./cutout";
import { drawnImageRect, type ImageFacts, type Rect } from "./ground";

function facts(
  width: number,
  height: number,
  ink: ImageFacts["ink"],
): ImageFacts {
  return {
    width,
    height,
    cutout: true,
    ink,
    grid: { cols: 1, rows: 1, rgba: [0, 0, 0, 0] },
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

/* The visual verdict's blocking finding: banner-bottom 1:1 cut the plate's
   shadow with a hard line, and the fruit touched the top edge. Containment
   is checked as geometry over many frames and subject positions, including
   a subject pressed into a corner of its file. */
const FRAMES: Rect[] = [
  { x: 0, y: 0, width: 1080, height: 512 },
  { x: 0, y: 0, width: 1344, height: 300 },
  { x: 562, y: 0, width: 518, height: 1350 },
  { x: 0, y: 0, width: 1080, height: 1350 },
  { x: 0, y: 0, width: 400, height: 90 },
];
const INKS: ImageFacts["ink"][] = [
  { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
  { left: 0.1, top: 0.31, right: 0.9, bottom: 0.76 },
  { left: 0, top: 0, right: 0.3, bottom: 0.2 },
  { left: 0.7, top: 0.6, right: 1, bottom: 1 },
  { left: 0, top: 0, right: 1, bottom: 1 },
];

describe("containedSubject", () => {
  for (const frame of FRAMES) {
    for (const ink of INKS) {
      for (const [w, h] of [
        [500, 500],
        [1200, 800],
        [600, 1400],
      ]) {
        const label = `${frame.width}x${frame.height} ink=${JSON.stringify(ink)} ${w}x${h}`;
        it(`keeps the whole subject inside its target: ${label}`, () => {
          const target = {
            x: frame.x + 40,
            y: frame.y + 20,
            width: frame.width - 80,
            height: frame.height - 40,
          };
          const image = facts(w, h, ink);
          const { placement, subject } = containedSubject(image, frame, target);
          expect(placement.fit).toBe("contain");
          expect(placement.zoom).toBeGreaterThanOrEqual(1);
          expect(placement.zoom).toBeLessThanOrEqual(10);
          expect(placement.focusX).toBeGreaterThanOrEqual(0);
          expect(placement.focusX).toBeLessThanOrEqual(1);
          expect(placement.focusY).toBeGreaterThanOrEqual(0);
          expect(placement.focusY).toBeLessThanOrEqual(1);
          /* Never cropped: the subject is inside the frame the element
             clips to, and it is what subjectRect says. */
          expect(inside(subject, frame), label).toBe(true);
          expect(subject).toEqual(subjectRect(image, placement));
        });
      }
    }
  }

  it("fills the target with the subject, not with its transparent margin", () => {
    const frame = { x: 0, y: 0, width: 1080, height: 600 };
    const target = { x: 86, y: 86, width: 908, height: 514 };
    const { subject } = containedSubject(
      facts(400, 400, { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 }),
      frame,
      target,
    );
    /* A 1:1 subject in a 908x514 target is height-bound: it fills the
       height, where plain contain would have used half of it. */
    expect(subject.height).toBeGreaterThan(target.height * 0.97);
    expect(inside(subject, target)).toBe(true);
    /* And it is centred on the target. */
    expect(subject.x + subject.width / 2).toBeCloseTo(
      target.x + target.width / 2,
      0,
    );
  });

  it("falls back to plain contain, which can never crop, when nothing larger fits", () => {
    const frame = { x: 0, y: 0, width: 300, height: 300 };
    const image = facts(300, 300, { left: 0, top: 0, right: 1, bottom: 1 });
    const { placement } = containedSubject(image, frame, {
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
    expect(placement.zoom).toBe(1);
    expect(drawnImageRect(image, placement)).toEqual(frame);
  });
});
