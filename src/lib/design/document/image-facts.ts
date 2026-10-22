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
  let left = cols;
  let top = rows;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const alpha = rgba[(y * cols + x) * 4 + 3];
      if (alpha < 250) seeThrough += 1;
      if (alpha < VISIBLE_ALPHA) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  const visible = right > left && bottom > top;
  return {
    width: size.width,
    height: size.height,
    cutout: seeThrough / (cols * rows) >= CUTOUT_SHARE,
    /* A cell straddles the real edge, so the box is widened by one cell on
       each side: the subject is then never larger than the box says. */
    ink: visible
      ? {
          left: Math.max(0, (left - 1) / cols),
          top: Math.max(0, (top - 1) / rows),
          right: Math.min(1, (right + 1) / cols),
          bottom: Math.min(1, (bottom + 1) / rows),
        }
      : { left: 0, top: 0, right: 1, bottom: 1 },
    grid: { cols, rows, rgba },
  };
}
