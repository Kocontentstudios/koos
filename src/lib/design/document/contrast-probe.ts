import { relativeLuminance, rgbLuminance } from "@/lib/design/palette";
import type { DecodedPng } from "@/lib/images/png-pixels";
import type { DesignDocument, TextElement } from "./schema";

/**
 * How well each run of copy reads on the picture behind it, measured on a
 * render, not predicted.
 *
 * `ground` is the document drawn with its copy hidden. For every text
 * element, every ground pixel inside its box is compared with the text
 * colour; the result is the share of those pixels below WCAG's 4.5:1 (body
 * text) and 3:1 (large text). The box is larger than the ink, so this is
 * the stricter reading: a pixel between two lines counts too.
 */

export interface CopyContrast {
  id: string;
  /** Share of ground pixels in the box below 4.5:1 against the text. */
  under45: number;
  /** Share below 3:1. */
  under3: number;
}

function luminanceAt(pixels: Uint8Array, at: number): number {
  return rgbLuminance(pixels[at], pixels[at + 1], pixels[at + 2]);
}

export function copyContrast(
  ground: DecodedPng,
  doc: DesignDocument,
): CopyContrast[] {
  return doc.elements
    .filter((e): e is TextElement => e.type === "text" && !e.hidden)
    .map((element) => {
      const text = relativeLuminance(element.color);
      let total = 0;
      let under45 = 0;
      let under3 = 0;
      const left = Math.max(0, Math.floor(element.x));
      const top = Math.max(0, Math.floor(element.y));
      const right = Math.min(
        ground.width,
        Math.ceil(element.x + element.width),
      );
      const bottom = Math.min(
        ground.height,
        Math.ceil(element.y + element.height),
      );
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const back = luminanceAt(ground.pixels, (y * ground.width + x) * 4);
          const ratio =
            (Math.max(back, text) + 0.05) / (Math.min(back, text) + 0.05);
          total += 1;
          if (ratio < 4.5) under45 += 1;
          if (ratio < 3) under3 += 1;
        }
      }
      return {
        id: element.id,
        under45: total ? under45 / total : 0,
        under3: total ? under3 / total : 0,
      };
    });
}

/** The document with its copy hidden: the ground copyContrast reads. */
export function withoutCopy(doc: DesignDocument): DesignDocument {
  return {
    ...doc,
    elements: doc.elements.map((element) =>
      element.type === "text" ? { ...element, hidden: true } : element,
    ),
  };
}
