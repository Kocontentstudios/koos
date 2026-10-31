import { contrastRatio, type ResolvedPalette } from "@/lib/design/palette";
import type { DesignSpec } from "@/lib/design/spec";
import {
  glyphOverhang,
  type InkExtent,
  type TextLook,
  type TextMeasurer,
} from "../fit";
import type {
  AssetRef,
  DesignElement,
  ImageElement,
  ShapeElement,
  TextElement,
  TextRole,
} from "../schema";
import type { SubjectBox } from "../subject";
import type { ImageFacts, ImagePlacement, Rect } from "./ground";

/**
 * What every layout builder shares: the canvas, the copy's measurer, the
 * element factories and the faults raised while fitting.
 *
 * Geometry is integer pixels so the browser editor and satori place every
 * box on the same pixel.
 */

export type { Rect };

export interface DocumentLogoInput {
  asset: AssetRef;
  /** Width/height of the mark, so its box is the mark's own footprint. */
  aspect?: number;
}

export interface Context {
  spec: DesignSpec;
  palette: ResolvedPalette;
  width: number;
  height: number;
  /** The shorter side. Every size keys off it, as in the flex layouts, so a
   *  landscape canvas does not get type sized for its long edge. */
  ref: number;
  margin: number;
  image: AssetRef | null;
  /** Measured facts about the image, when the caller has its bytes. Without
   *  them a photo is treated as the worst ground and a cut-out as a photo. */
  imageFacts: ImageFacts | null;
  /** The image's subject in image space: given by the caller, or a
   *  cut-out's visible pixels. Null when nothing is known about it, and
   *  then no layout can keep copy off it. */
  subject: SubjectBox | null;
  /** People's heads in image space, each kept whole or out of a crop. */
  heads?: readonly SubjectBox[];
  /** Where the other design of the pair draws the same photo, in canvas
   *  shares: an arrangement free to choose its side keeps apart from it. */
  siblingPhoto?: SubjectBox | null;
  logoBox: Rect | null;
  logo: DocumentLogoInput | null;
  measurer: TextMeasurer;
  /** Footer type at its role's minimum instead of the largest that fits,
   *  to give the copy above it room (from-spec.ts buildLeading). */
  smallFooter: boolean;
  /** Quality faults raised while building, for the caller to report. */
  faults: Set<string>;
  /** Raised when a layout cannot keep its copy off the subject or show the
   *  subject whole at SUBJECT_MIN_SHARE (subject.ts). */
  subjectFaults: Set<string>;
}

export const WHITE = "#FFFFFF";
export const NEAR_BLACK = "#111111";

/** Copy that fits only by breaking a word mid-word, at the legibility floor. */
export const COPY_WORD_BROKEN =
  "a word in the copy is too long to fit at a readable size, so it is broken across lines; shorten it for a clean design";

/** Copy that does not fit its layout even at the smallest readable size. */
export const COPY_TOO_LONG =
  "the copy is too long for this layout at a readable size; shorten it or choose another layout";

/** Copy that fits only below its layout's type scale, still above the
 *  legibility floor. Readable, but weaker than the layout was designed for. */
export const COPY_SHRUNK =
  "the copy is longer than this layout holds at its usual type sizes, so some of it is set smaller; shorten it for a stronger design";

export function px(value: number): number {
  return Math.round(value);
}

export function rect(
  x: number,
  y: number,
  width: number,
  height: number,
): Rect {
  return {
    x: px(x),
    y: px(y),
    width: Math.max(1, px(width)),
    height: Math.max(1, px(height)),
  };
}

export function base(id: string, name: string, box: Rect) {
  return {
    id,
    name,
    ...rect(box.x, box.y, box.width, box.height),
    rotation: 0,
    opacity: 1,
    hidden: false,
    locked: false,
  };
}

/** The candidate with the most contrast against `ground`. */
export function mostReadableOn(ground: string, candidates: string[]): string {
  return candidates.reduce((best, candidate) =>
    contrastRatio(candidate, ground) > contrastRatio(best, ground)
      ? candidate
      : best,
  );
}

export function imageElement(
  asset: AssetRef,
  box: Rect,
  placement?: ImagePlacement,
): ImageElement {
  return {
    ...base("image", "Image", box),
    type: "image",
    asset,
    fit: placement?.fit ?? "cover",
    crop: {
      zoom: placement?.zoom ?? 1,
      focusX: placement?.focusX ?? 0.5,
      focusY: placement?.focusY ?? 0.5,
    },
    radius: 0,
  };
}

export function shapeElement(
  id: string,
  name: string,
  box: Rect,
  fill: string,
  extra: Partial<
    Pick<ShapeElement, "radius" | "borderColor" | "borderWidth">
  > = {},
): ShapeElement {
  return {
    ...base(id, name, box),
    type: "shape",
    fill,
    borderColor: extra.borderColor ?? "transparent",
    borderWidth: extra.borderWidth ?? 0,
    radius: extra.radius ?? 0,
  };
}

export function textElement(
  id: string,
  name: string,
  role: TextRole,
  text: string,
  look: TextLook,
  color: string,
  content: Rect,
  /** Measured reach of the glyphs past the layout box (fit.ts inkOverhang).
   *  Without it, glyphOverhang's allowance on both sides. */
  ink?: InkExtent,
): TextElement {
  /* The element is the laid-out box plus room for glyphs that overshoot it,
     so the ink, not just the layout, stays inside the element. The same room
     on both sides, because the renderer centres the run in its element. */
  const overhang = ink ? Math.max(ink.above, ink.below) : glyphOverhang(look);
  return {
    ...base(id, name, {
      x: content.x,
      y: content.y - overhang,
      width: content.width,
      height: content.height + overhang * 2,
    }),
    type: "text",
    text,
    role,
    ...look,
    color,
  };
}

export function logoElement(ctx: Context): DesignElement | null {
  if (!ctx.logo || !ctx.logoBox) return null;
  return {
    ...base("logo", "Logo", ctx.logoBox),
    type: "logo",
    asset: ctx.logo.asset,
    backing: null,
  };
}

export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x - gap < b.x + b.width &&
    a.x + a.width + gap > b.x &&
    a.y - gap < b.y + b.height &&
    a.y + a.height + gap > b.y
  );
}

export interface Built {
  background: string;
  elements: DesignElement[];
}
