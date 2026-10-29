import { ImageResponse } from "next/og";
import { createElement } from "react";
import { readImageDimensions } from "@/lib/design/png-dimensions";
import { decodePngRgba } from "@/lib/images/png-pixels";
import type { ImageFacts } from "./builders/ground";

/**
 * The facts documentFromSpec needs about an image, read from its bytes.
 *
 * resvg decodes the image (PNG or JPEG, the only types an upload or a plate
 * can be) into a small grid, the same decoder that will draw it, so the
 * measurement is of the pixels the design will actually show. No native
 * image library is needed and nothing here touches the network.
 */

/** Cells on the long edge. Coarse on purpose: a reader judges copy against
 *  the background around it, not against single pixels. */
const GRID = 96;

/** Alpha below this is "see-through". Soft shadows go down to a few percent,
 *  and they are part of the subject a cut-out must keep whole. */
const VISIBLE_ALPHA = 6;

/** Share of see-through cells that makes an image a cut-out rather than a
 *  photo with a few transparent edge pixels. */
const CUTOUT_SHARE = 0.02;

/** A separate patch of pixels with less than this share of the largest
 *  patch's alpha is debris from the cut (a dot, a hairline along an edge),
 *  not part of the subject. A second product in the same file is far
 *  heavier than this. */
const DEBRIS_SHARE = 0.05;

/** A patch this many cells thick or less is a hairline left along a cut
 *  or the frame's edge, however long, unless it is all there is. */
const HAIRLINE_CELLS = 2;

type Cells = { cols: number; rows: number; alpha: (i: number) => number };

/* Bad matting leaves a faint veil over the whole file; its level is what
   the frame's edge carries, since a cut-out's subject rarely fills the
   border. Pixels must stand clear of it to count, so the veil is not the
   subject while a shadow, much denser near the product, still is. */
function visibleAlpha({ cols, rows, alpha }: Cells): number {
  const border: number[] = [];
  for (let x = 0; x < cols; x += 1) {
    border.push(alpha(x), alpha((rows - 1) * cols + x));
  }
  for (let y = 1; y < rows - 1; y += 1) {
    border.push(alpha(y * cols), alpha(y * cols + cols - 1));
  }
  border.sort((a, b) => a - b);
  const veil = border[Math.floor(border.length / 2)] ?? 0;
  return veil < VISIBLE_ALPHA ? VISIBLE_ALPHA : veil * 2 + VISIBLE_ALPHA;
}

/**
 * The cells of the subject: every 8-connected patch of visible cells but
 * the debris, as a bounding box in cells. Null when nothing is visible.
 */
export function subjectCells(cells: Cells): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} | null {
  const { cols, rows, alpha } = cells;
  const floor = visibleAlpha(cells);
  const patch = new Int32Array(cols * rows).fill(-1);
  const patches: {
    mass: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  }[] = [];
  for (let start = 0; start < cols * rows; start += 1) {
    if (patch[start] !== -1 || alpha(start) < floor) continue;
    const found = {
      mass: 0,
      left: cols,
      top: rows,
      right: 0,
      bottom: 0,
    };
    const id = patches.length;
    patches.push(found);
    patch[start] = id;
    const stack = [start];
    while (stack.length > 0) {
      const at = stack.pop() as number;
      const x = at % cols;
      const y = (at - x) / cols;
      found.mass += alpha(at);
      found.left = Math.min(found.left, x);
      found.top = Math.min(found.top, y);
      found.right = Math.max(found.right, x + 1);
      found.bottom = Math.max(found.bottom, y + 1);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const next = ny * cols + nx;
          if (patch[next] !== -1 || alpha(next) < floor) continue;
          patch[next] = id;
          stack.push(next);
        }
      }
    }
  }
  const heaviest = Math.max(0, ...patches.map((p) => p.mass));
  const kept = patches.filter(
    (p) =>
      p.mass === heaviest ||
      (p.mass >= heaviest * DEBRIS_SHARE &&
        Math.min(p.right - p.left, p.bottom - p.top) > HAIRLINE_CELLS),
  );
  if (kept.length === 0) return null;
  return {
    left: Math.min(...kept.map((p) => p.left)),
    top: Math.min(...kept.map((p) => p.top)),
    right: Math.max(...kept.map((p) => p.right)),
    bottom: Math.max(...kept.map((p) => p.bottom)),
  };
}

export async function measureImage(asset: {
  bytes: Uint8Array;
  contentType: string;
}): Promise<ImageFacts | null> {
  const size = readImageDimensions(asset.bytes);
  if (!size) return null;
  const scale = GRID / Math.max(size.width, size.height);
  const cols = Math.max(1, Math.round(size.width * scale));
  const rows = Math.max(1, Math.round(size.height * scale));
  const src = `data:${asset.contentType};base64,${Buffer.from(asset.bytes).toString("base64")}`;
  const response = new ImageResponse(
    createElement(
      "div",
      { style: { display: "flex", width: cols, height: rows } },
      createElement("img", {
        src,
        width: cols,
        height: rows,
        style: { width: cols, height: rows },
      }),
    ),
    { width: cols, height: rows },
  );
  const decoded = decodePngRgba(new Uint8Array(await response.arrayBuffer()));
  if (!decoded) return null;

  const rgba = Array.from(decoded.pixels);
  let seeThrough = 0;
  for (let i = 0; i < cols * rows; i += 1) {
    if (rgba[i * 4 + 3] < 250) seeThrough += 1;
  }
  const subject = subjectCells({
    cols,
    rows,
    alpha: (i) => rgba[i * 4 + 3],
  });
  return {
    width: size.width,
    height: size.height,
    cutout: seeThrough / (cols * rows) >= CUTOUT_SHARE,
    /* A cell straddles the real edge, so the box is widened by one cell on
       each side: the subject is then never larger than the box says. */
    ink: subject
      ? {
          left: Math.max(0, (subject.left - 1) / cols),
          top: Math.max(0, (subject.top - 1) / rows),
          right: Math.min(1, (subject.right + 1) / cols),
          bottom: Math.min(1, (subject.bottom + 1) / rows),
        }
      : /* Nothing visible: an empty box, which resolveSubject refuses
           rather than treating the whole file as the product. */
        { left: 0, top: 0, right: 0, bottom: 0 },
    grid: { cols, rows, rgba },
  };
}
