import type { LoadedFont } from "@/lib/design/render/fonts";
import { rasterize } from "@/lib/design/render/rasterize";
import { decodePngRgba } from "@/lib/images/png-pixels";
import { documentElement } from "./render";
import type { DesignDocument, DesignElement } from "./schema";

/**
 * Test support: where an element's ink actually lands.
 *
 * Each text element or button is rendered alone, black on white, and the
 * bounding box of its dark pixels is read back. Checking ink rather than
 * layout boxes is the point: a box that is right on paper but whose glyphs
 * spill out of it is exactly the bug these tests exist for.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Antialiasing can put a faint pixel one step past the edge. */
export const INK_TOLERANCE = 1;

export function solo(
  doc: DesignDocument,
  element: DesignElement,
): DesignDocument {
  const black =
    element.type === "text"
      ? { ...element, color: "#000000", opacity: 1 }
      : element.type === "button"
        ? { ...element, fill: "#FFFFFF", color: "#000000" }
        : element;
  return { ...doc, background: "#FFFFFF", elements: [black] };
}

export function inkBox(png: {
  width: number;
  height: number;
  pixels: Uint8Array | Uint8ClampedArray;
}): Box | null {
  let box: Box | null = null;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const at = (y * png.width + x) * 4;
      const darkest = Math.min(
        png.pixels[at],
        png.pixels[at + 1],
        png.pixels[at + 2],
      );
      if (darkest > 160) continue;
      box = box
        ? {
            left: Math.min(box.left, x),
            top: Math.min(box.top, y),
            right: Math.max(box.right, x + 1),
            bottom: Math.max(box.bottom, y + 1),
          }
        : { left: x, top: y, right: x + 1, bottom: y + 1 };
    }
  }
  return box;
}

/** Room around a lone element for ink that escapes its box to land in. */
const MARGIN = 64;

/**
 * The element alone on a canvas just larger than its box, and the offset
 * back to document coordinates. Layout does not depend on where a box sits,
 * so the ink is the same as on the full canvas at a fraction of the
 * rasterising cost.
 */
export function cropped(
  doc: DesignDocument,
  element: DesignElement,
): { doc: DesignDocument; dx: number; dy: number } {
  const alone = solo(doc, element);
  const dx = element.x - MARGIN;
  const dy = element.y - MARGIN;
  return {
    doc: {
      ...alone,
      width: Math.ceil(element.width) + MARGIN * 2,
      height: Math.ceil(element.height) + MARGIN * 2,
      elements: alone.elements.map((e) => ({ ...e, x: MARGIN, y: MARGIN })),
    },
    dx,
    dy,
  };
}

export function shifted(box: Box | null, dx: number, dy: number): Box | null {
  return box
    ? {
        left: box.left + dx,
        top: box.top + dy,
        right: box.right + dx,
        bottom: box.bottom + dy,
      }
    : null;
}

export async function satoriInk(
  doc: DesignDocument,
  element: DesignElement,
  fonts: LoadedFont[],
): Promise<Box | null> {
  const crop = cropped(doc, element);
  const png = decodePngRgba(
    await rasterize(
      documentElement(crop.doc, {}),
      { width: crop.doc.width, height: crop.doc.height },
      fonts,
    ),
  );
  if (!png) throw new Error("render did not decode");
  return shifted(clipped(inkBox(png), png), crop.dx, crop.dy);
}

/**
 * Ink that reaches the edge of the cropped canvas was cut off there, so it
 * went further than the crop can show: pushed out by a whole margin, which
 * no tolerance accepts, rather than reported as just touching the edge.
 */
export function clipped(
  box: Box | null,
  canvas: { width: number; height: number },
): Box | null {
  if (!box) return null;
  return {
    left: box.left <= 0 ? -MARGIN : box.left,
    top: box.top <= 0 ? -MARGIN : box.top,
    right: box.right >= canvas.width ? canvas.width + MARGIN : box.right,
    bottom: box.bottom >= canvas.height ? canvas.height + MARGIN : box.bottom,
  };
}

/** How far `ink` reaches outside `element` (or the canvas), in px; zero or
 *  negative when it is inside. */
export function overflowOf(
  ink: Box,
  element: Pick<DesignElement, "x" | "y" | "width" | "height">,
  canvas: { width: number; height: number },
): number {
  return Math.max(
    element.x - ink.left,
    element.y - ink.top,
    ink.right - (element.x + element.width),
    ink.bottom - (element.y + element.height),
    -ink.left,
    -ink.top,
    ink.right - canvas.width,
    ink.bottom - canvas.height,
  );
}

export function intersects(a: Box, b: Box): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}
