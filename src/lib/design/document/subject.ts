import { rgbLuminance } from "@/lib/design/palette";
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

/** The least share of the image a subject spans on each axis. A box
 *  smaller than this is a detection glitch, not a product: drawn at
 *  SUBJECT_MIN_SHARE it would be magnified past any sharp rendering, and a
 *  layout would report it covered when the problem is its size. */
export const MIN_SUBJECT_SIDE = 0.02;

export const SUBJECT_BOX_INVALID = "SUBJECT_BOX_INVALID" as const;

/** Why `value` is not a subject box a layout can keep, or null when it is.
 *  Never clamped: a box a vision model rounded past the edge, or one with a
 *  NaN, says nothing reliable about where the product is, and a clamped
 *  guess put copy over the product with no fault. */
export function subjectBoxProblem(value: unknown): string | null {
  if (!value || typeof value !== "object") return "it is not a box";
  const box = value as Record<string, unknown>;
  for (const side of ["x", "y", "w", "h"] as const) {
    const n = box[side];
    if (typeof n !== "number" || !Number.isFinite(n)) {
      return `${side} is not a number`;
    }
    if (n < 0 || n > 1) return `${side} is ${n}, outside 0 to 1`;
  }
  const { x, y, w, h } = box as unknown as SubjectBox;
  if (x + w > 1 + 1e-9) return `it reaches ${x + w} of the image's width`;
  if (y + h > 1 + 1e-9) return `it reaches ${y + h} of the image's height`;
  if (w < MIN_SUBJECT_SIDE || h < MIN_SUBJECT_SIDE) {
    return `it is ${w} by ${h} of the image, smaller than ${MIN_SUBJECT_SIDE} on a side`;
  }
  return null;
}

export function isSubjectBox(value: unknown): value is SubjectBox {
  return subjectBoxProblem(value) === null;
}

/** A subject box documentFromSpec cannot lay out, raised instead of
 *  guessing. The job reports it as a fault and does not draw the design. */
export class SubjectBoxFault extends Error {
  readonly code = SUBJECT_BOX_INVALID;
  constructor(
    readonly problem: string,
    /** "given" for a caller's box, "alpha" for one read from a cut-out. */
    readonly source: "given" | "alpha",
  ) {
    super(
      source === "alpha"
        ? "the cut-out's visible part is too small to place; upload an image where the product fills more of the frame"
        : `the product's position in the photo could not be used (${problem})`,
    );
    this.name = "SubjectBoxFault";
  }
}

/** A cut-out's subject is its visible pixels, read from the alpha channel
 *  by measureImage (image-facts.ts), shadow included, debris left out. */
export function subjectFromAlpha(facts: ImageFacts): SubjectBox {
  const { ink } = facts;
  return {
    x: ink.left,
    y: ink.top,
    w: ink.right - ink.left,
    h: ink.bottom - ink.top,
  };
}

/** The subject a build lays out: the caller's box, else a cut-out's alpha,
 *  else none. Throws SubjectBoxFault for a box it cannot keep. */
export function resolveSubject(
  given: SubjectBox | null | undefined,
  facts: ImageFacts | null,
): SubjectBox | null {
  if (given !== null && given !== undefined) {
    const problem = subjectBoxProblem(given);
    if (problem) throw new SubjectBoxFault(problem, "given");
    return given;
  }
  if (!facts?.cutout) return null;
  const alpha = subjectFromAlpha(facts);
  const problem = subjectBoxProblem(alpha);
  if (problem) throw new SubjectBoxFault(problem, "alpha");
  return alpha;
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
  heads: readonly SubjectBox[] = [],
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
        if (cutsAHead(image, heads, placement)) continue;
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

/** Overlap of two picture frames, as a share of their union, past which
 *  two designs of a pair read as one shape whatever their arrangement. */
export const SAME_PLACE_SHARE = 0.6;

/** Overlap of two boxes as a share of their union. */
export function overlapShare(a: SubjectBox, b: SubjectBox): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const shared = w * h;
  const union = a.w * a.h + b.w * b.h - shared;
  return union > 0 ? shared / union : 0;
}

/** Oluwaseyi's ruling of 2026-10-29: over a full-bleed photo, the band of
 *  copy may lie on the outer edge of the subject box, under a dark veil,
 *  never on more than this share of the box's width (side band) or height
 *  (top or bottom band), and never on a face or head box. A portrait or a
 *  facade whose box spans most of the frame otherwise had no full bleed at
 *  all, and its pair shipped as a left/right mirror (round-9 live critic). */
export const BAND_COVER_MAX = 0.25;

export type BandSide = "left" | "right" | "top" | "bottom";

export const isSideBand = (side: BandSide) =>
  side === "left" || side === "right";

/** The share of `subject` (on the canvas) under `band`, along the axis the
 *  band runs into it. */
export function bandCover(subject: Rect, band: Rect, side: BandSide): number {
  const hit = intersection(subject, band);
  if (!hit) return 0;
  return isSideBand(side)
    ? hit.width / Math.max(1, subject.width)
    : hit.height / Math.max(1, subject.height);
}

export interface BandedPlacement {
  placement: ImagePlacement;
  /** bandCover of the placed subject. */
  cover: number;
}

/**
 * A cover placement in `frame` for a band of copy on `side`: the subject
 * whole in the frame and at least `minEdge`, no head cut by the frame's
 * edge or within `gap` of the band, nothing of `avoid` on the subject, and
 * the band on no more than BAND_COVER_MAX of the subject. The least zoom
 * that works, and at it the least cover, then the subject nearest the
 * middle of the frame's uncovered part. Null when none does.
 */
export function bandedPlacement(
  image: { width: number; height: number },
  subject: SubjectBox,
  frame: Rect,
  band: Rect,
  side: BandSide,
  {
    heads,
    avoid,
    minEdge,
    gap,
  }: {
    heads: readonly SubjectBox[];
    avoid: Rect[];
    minEdge: number;
    gap: number;
  },
): BandedPlacement | null {
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
  const headZone = grown(band, gap);
  const open = openPart(frame, band, side);
  const centreX = open.x + open.width / 2;
  const centreY = open.y + open.height / 2;
  for (const zoom of ZOOMS) {
    const size = subjectOnCanvas(image, subject, {
      frame,
      fit: "cover",
      zoom,
      focusX: 0.5,
      focusY: 0.5,
    });
    if (Math.max(size.width, size.height) < minEdge) continue;
    if (
      (isSideBand(side) ? size.width : size.height) * (1 - BAND_COVER_MAX) >
      (isSideBand(side) ? open.width : open.height) + 0.5
    ) {
      /* Zoom only grows the subject, so the open part cannot hold three
         quarters of it at any larger zoom either. */
      return null;
    }
    let best: (BandedPlacement & { distance: number }) | null = null;
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
        const cover = bandCover(box, band, side);
        if (cover > BAND_COVER_MAX) continue;
        if (best && cover > best.cover + 1e-9) continue;
        if (avoid.some((zone) => intersection(box, zone))) continue;
        if (cutsAHead(image, heads, placement)) continue;
        if (
          heads.some((head) =>
            intersection(subjectOnCanvas(image, head, placement), headZone),
          )
        ) {
          continue;
        }
        const distance = Math.hypot(
          box.x + box.width / 2 - centreX,
          box.y + box.height / 2 - centreY,
        );
        if (!best || cover < best.cover - 1e-9 || distance < best.distance) {
          best = { placement, cover, distance };
        }
      }
    }
    if (best) return { placement: best.placement, cover: best.cover };
  }
  return null;
}

/** The part of `frame` the band leaves open. */
function openPart(frame: Rect, band: Rect, side: BandSide): Rect {
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  switch (side) {
    case "left": {
      const x = Math.max(frame.x, band.x + band.width);
      return {
        x,
        y: frame.y,
        width: Math.max(0, right - x),
        height: frame.height,
      };
    }
    case "right":
      return {
        x: frame.x,
        y: frame.y,
        width: Math.max(0, Math.min(right, band.x) - frame.x),
        height: frame.height,
      };
    case "top": {
      const y = Math.max(frame.y, band.y + band.height);
      return {
        x: frame.x,
        y,
        width: frame.width,
        height: Math.max(0, bottom - y),
      };
    }
    case "bottom":
      return {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: Math.max(0, Math.min(bottom, band.y) - frame.y),
      };
  }
}

/** A head the frame's edge runs through: neither whole inside the frame
 *  nor wholly outside it. */
export function cutsAHead(
  image: { width: number; height: number },
  heads: readonly SubjectBox[],
  placement: ImagePlacement,
): boolean {
  return heads.some((head) => {
    const box = subjectOnCanvas(image, head, placement);
    return (
      !within(box, placement.frame) &&
      intersection(box, placement.frame) !== null
    );
  });
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
  /** Copy on the subject's outer edge under a dark veil (BAND_COVER_MAX):
   *  allowed, so not among `overlaps`, and listed for the record. */
  veiled: SubjectOverlap[];
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
  heads: readonly SubjectBox[] = [],
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
  const gap = ref * SUBJECT_GAP;
  const guard = grown(visible ?? box, gap);
  const placement: ImagePlacement = {
    frame,
    fit: element.fit,
    zoom: element.crop.zoom,
    focusX: element.crop.focusX,
    focusY: element.crop.focusY,
  };
  const veiledBand = darkBandOver(
    doc,
    visible ?? box,
    heads.map((head) => grown(subjectOnCanvas(image, head, placement), gap)),
  );
  const overlaps: SubjectOverlap[] = [];
  const veiled: SubjectOverlap[] = [];
  for (const other of doc.elements) {
    if (!guardsSubject(other, doc)) continue;
    const at = {
      x: other.x,
      y: other.y,
      width: other.width,
      height: other.height,
    };
    const hit = intersection(guard, at);
    if (hit) {
      (veiledBand(at) ? veiled : overlaps).push({
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
    veiled,
    visibleShare,
    edgeShare,
    overlaps,
    ok:
      overlaps.length === 0 &&
      visibleShare > 0.995 &&
      edgeShare >= SUBJECT_MIN_SHARE - 0.005,
  };
}

/* The gradient a veil is drawn with names the edge it is densest at
   (scrim.ts scrimElement: from the clear edge to the dense one). */
const VEIL_SIDE: Record<string, BandSide> = {
  "270": "left",
  "90": "right",
  "0": "top",
  "180": "bottom",
};

/* Luminance at or under which a veil reads dark: black and the darkest
   greys, never a brand tint over the subject. */
const DARK_VEIL = 0.05;

function veilOf(doc: DesignDocument): { box: Rect; side: BandSide } | null {
  const scrim = doc.elements.find(
    (e) => e.type === "shape" && e.id === "scrim" && !e.hidden,
  );
  const fill = scrim && "fill" in scrim ? String(scrim.fill) : "";
  const angle = /^linear-gradient\((\d+)deg/.exec(fill)?.[1];
  const side = angle ? VEIL_SIDE[angle] : undefined;
  if (!scrim || !side) return null;
  const colours = [...fill.matchAll(/rgba\((\d+),(\d+),(\d+),/g)];
  if (
    colours.length === 0 ||
    colours.some(
      ([, r, g, b]) =>
        rgbLuminance(Number(r), Number(g), Number(b)) > DARK_VEIL,
    )
  ) {
    return null;
  }
  return {
    box: { x: scrim.x, y: scrim.y, width: scrim.width, height: scrim.height },
    side,
  };
}

/**
 * Whether an element on the subject is allowed by Oluwaseyi's ruling of
 * 2026-10-29: inside a dark veil's box, reaching no further into the
 * subject than BAND_COVER_MAX from the veil's side, and clear of every
 * head (given grown by the gap).
 */
function darkBandOver(
  doc: DesignDocument,
  subject: Rect,
  heads: Rect[],
): (at: Rect) => boolean {
  const veil = veilOf(doc);
  if (!veil) return () => false;
  const reach = {
    left: (at: Rect) =>
      at.x + at.width <= subject.x + subject.width * BAND_COVER_MAX + 0.5,
    right: (at: Rect) =>
      at.x >= subject.x + subject.width * (1 - BAND_COVER_MAX) - 0.5,
    top: (at: Rect) =>
      at.y + at.height <= subject.y + subject.height * BAND_COVER_MAX + 0.5,
    bottom: (at: Rect) =>
      at.y >= subject.y + subject.height * (1 - BAND_COVER_MAX) - 0.5,
  }[veil.side];
  return (at) =>
    within(at, veil.box) &&
    reach(at) &&
    !heads.some((head) => intersection(head, at));
}
