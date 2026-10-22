import type { ImageFacts, ImagePlacement, Rect } from "./builders/ground";
import { drawnImageRect } from "./builders/ground";
import type { DesignDocument, DesignElement, ImageElement } from "./schema";

/**
 * The subject of an image (the product, the face and shoulders) and the rule
 * every layout keeps with it.
 *
 * Without it the uploaded product was shrunk to an 18%
 * thumbnail, and an accent rule, a quote mark and a headline laid across
 * it. So a layout is given the subject's box and must:
 *  - keep the headline, subheadline, CTA, accent rule, quote mark, footer,
 *    logo and every other small decoration out of it, with SUBJECT_GAP to
 *    spare;
 *  - draw it whole and at least SUBJECT_MIN_SHARE of the canvas's shorter
 *    side on its longer edge.
 * When an arrangement cannot, the layout tries its next one; when none can,
 * it says so with a fault. measureSubject is the same rule as a measurement,
 * for the job and the eval to run on any document.
 */

/** A box in image space, every value a share (0..1) of the image. */
export interface SubjectBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The subject's longer edge, as a share of the canvas's shorter side.
 *  35% keeps a product the first thing seen on a phone, where a 1080px post
 *  shows at about 360px: the subject is then at least 126px across. The
 *  thumbnails it replaces were 18% to 34%. */
export const SUBJECT_MIN_SHARE = 0.35;

/** Clear space around the subject, as a share of the shorter side. */
export const SUBJECT_GAP = 0.02;

export const SUBJECT_COVERED =
  "the copy could not be kept off the product in this layout; choose another layout or a photo with more room around the product";
export const SUBJECT_CROPPED =
  "the product does not fit this layout whole at a readable size; choose another layout or a photo with more room around the product";

export function isSubjectBox(value: unknown): value is SubjectBox {
  if (!value || typeof value !== "object") return false;
  const box = value as Record<string, unknown>;
  const share = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  return (
    share(box.x) &&
    share(box.y) &&
    share(box.w) &&
    share(box.h) &&
    (box.w as number) > 0 &&
    (box.h as number) > 0 &&
    (box.x as number) + (box.w as number) <= 1 + 1e-9 &&
    (box.y as number) + (box.h as number) <= 1 + 1e-9
  );
}

/** A cut-out's subject is its visible pixels, read from the alpha channel
 *  by measureImage (image-facts.ts), shadow included. */
export function subjectFromAlpha(facts: ImageFacts): SubjectBox {
  const { ink } = facts;
  return {
    x: ink.left,
    y: ink.top,
    w: Math.max(1e-3, ink.right - ink.left),
    h: Math.max(1e-3, ink.bottom - ink.top),
  };
}

/** Where the subject lands on the canvas for a given placement. */
export function subjectOnCanvas(
  image: { width: number; height: number },
  subject: SubjectBox,
  placement: ImagePlacement,
): Rect {
  const drawn = drawnImageRect(image, placement);
  return {
    x: drawn.x + subject.x * drawn.width,
    y: drawn.y + subject.y * drawn.height,
    width: subject.w * drawn.width,
    height: subject.h * drawn.height,
  };
}

export function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

export function grown(box: Rect, by: number): Rect {
  return {
    x: box.x - by,
    y: box.y - by,
    width: box.width + by * 2,
    height: box.height + by * 2,
  };
}

function within(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

const ZOOMS = Array.from({ length: 151 }, (_, i) => 1 + i * 0.02);
const FOCI = Array.from({ length: 51 }, (_, i) => i / 50);

/**
 * A cover placement of a photograph in `frame` that shows the subject whole,
 * inside `frame`, clear of every `keepOut` rectangle, with its longer edge
 * at least `minEdge`. The least zoom that works, and at it the focus that
 * keeps the subject nearest the middle of the frame. Null when none does.
 *
 * A search over a grid (151 zooms by 51 by 51 foci) rather than algebra:
 * the keep-outs make the feasible set a union of pieces, and the grid costs
 * a few milliseconds.
 */
export function coverPlacement(
  image: { width: number; height: number },
  subject: SubjectBox,
  frame: Rect,
  keepOut: Rect[],
  minEdge: number,
): ImagePlacement | null {
  const centreX = frame.x + frame.width / 2;
  const centreY = frame.y + frame.height / 2;
  /* Zoom only enlarges the subject, so one that overfills the frame at
     zoom 1 overfills it at every zoom. */
  const least = subjectOnCanvas(image, subject, {
    frame,
    fit: "cover",
    zoom: 1,
    focusX: 0.5,
    focusY: 0.5,
  });
  if (least.width > frame.width + 0.5 || least.height > frame.height + 0.5) {
    return null;
  }
  for (const zoom of ZOOMS) {
    const size = subjectOnCanvas(image, subject, {
      frame,
      fit: "cover",
      zoom,
      focusX: 0.5,
      focusY: 0.5,
    });
    if (Math.max(size.width, size.height) < minEdge) continue;
    let best: { placement: ImagePlacement; distance: number } | null = null;
    for (const focusY of FOCI) {
      for (const focusX of FOCI) {
        const placement: ImagePlacement = {
          frame,
          fit: "cover",
          zoom: Math.round(zoom * 100) / 100,
          focusX,
          focusY,
        };
        const box = subjectOnCanvas(image, subject, placement);
        if (!within(box, frame)) continue;
        if (keepOut.some((zone) => intersection(box, zone))) continue;
        const distance = Math.hypot(
          box.x + box.width / 2 - centreX,
          box.y + box.height / 2 - centreY,
        );
        if (!best || distance < best.distance) best = { placement, distance };
      }
    }
    if (best) return best.placement;
  }
  return null;
}

/** What may never sit on the subject: copy, buttons, the logo, and shapes
 *  small enough to be decoration (the accent rule). Cards, panels, scrims
 *  and the footer bar are the ground the subject is drawn on or beside. */
const STRUCTURE = new Set([
  "card",
  "card-edge",
  "scrim",
  "accent-panel",
  "footer-bar",
]);

function guardsSubject(element: DesignElement, doc: DesignDocument): boolean {
  if (element.hidden) return false;
  if (element.type === "image") return false;
  if (element.type === "shape") {
    if (STRUCTURE.has(element.id)) return false;
    return element.width * element.height < doc.width * doc.height * 0.05;
  }
  return true;
}

export interface SubjectOverlap {
  id: string;
  type: DesignElement["type"];
  /** Overlap with the subject grown by SUBJECT_GAP, in px². */
  area: number;
}

export interface SubjectReport {
  /** The subject on the canvas, as drawn. */
  box: Rect;
  /** Share of the subject inside its image frame and the canvas. */
  visibleShare: number;
  /** Longer edge over the canvas's shorter side. */
  edgeShare: number;
  overlaps: SubjectOverlap[];
  /** True when nothing guarded overlaps, the subject is whole, and it is at
   *  least SUBJECT_MIN_SHARE. */
  ok: boolean;
}

/**
 * The subject rule as a measurement of a finished document: where the
 * subject landed, how much of it shows, how large it is, and which elements
 * sit on it. For the generation job and the eval; the builders keep the
 * same rule while placing.
 *
 * `image` is the pixel size of the image element's asset (ImageFacts).
 * Null when the document draws no image.
 */
export function measureSubject(
  doc: DesignDocument,
  image: { width: number; height: number },
  subject: SubjectBox,
): SubjectReport | null {
  const element = doc.elements.find(
    (e): e is ImageElement => e.type === "image" && !e.hidden,
  );
  if (!element) return null;
  const frame: Rect = {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
  const box = subjectOnCanvas(image, subject, {
    frame,
    fit: element.fit,
    zoom: element.crop.zoom,
    focusX: element.crop.focusX,
    focusY: element.crop.focusY,
  });
  const canvas: Rect = { x: 0, y: 0, width: doc.width, height: doc.height };
  const shown = intersection(box, frame);
  const visible = shown ? intersection(shown, canvas) : null;
  const area = box.width * box.height;
  const ref = Math.min(doc.width, doc.height);
  /* Only the part of the subject that is drawn can be covered: a photo
     cropped by its frame leaves the rest of its subject box over whatever
     sits beside the frame, which is copy by design in a split layout. The
     crop itself is visibleShare's to report. */
  const guard = grown(visible ?? box, ref * SUBJECT_GAP);
  const overlaps: SubjectOverlap[] = [];
  for (const other of doc.elements) {
    if (!guardsSubject(other, doc)) continue;
    const hit = intersection(guard, {
      x: other.x,
      y: other.y,
      width: other.width,
      height: other.height,
    });
    if (hit) {
      overlaps.push({
        id: other.id,
        type: other.type,
        area: Math.round(hit.width * hit.height),
      });
    }
  }
  const visibleShare = visible
    ? (visible.width * visible.height) / Math.max(1, area)
    : 0;
  const edgeShare = Math.max(box.width, box.height) / ref;
  return {
    box,
    visibleShare,
    edgeShare,
    overlaps,
    ok:
      overlaps.length === 0 &&
      visibleShare > 0.995 &&
      edgeShare >= SUBJECT_MIN_SHARE - 0.005,
  };
}
