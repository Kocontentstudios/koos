import { SaxesParser } from "saxes";
import { IMAGE_NOT_USABLE_PREFIX } from "@/lib/uploads/design-image-limits";
import type { SafeSvg } from "./svg-sanitize";

export const SVG_DRAWS_NOTHING_MESSAGE = `${IMAGE_NOT_USABLE_PREFIX}: nothing in it would show on a design once the HTML and editor data a logo can't use are left out. Export it again as a plain SVG, or upload a PNG.`;

/**
 * Whether a sanitised SVG has anything left to draw. sanitizeSvg leaves out
 * foreignObject and every element outside the SVG namespace, so a file made
 * only of those (HTML in a foreignObject, editor state) comes out as an empty
 * <svg>: accepted at upload, then NOT_DRAWABLE on every design (round-6
 * review, L1). The upload refuses it while the file is still in hand.
 *
 * Structural, not a raster: a graphics element outside the containers that
 * are never rendered directly (defs, symbol, clipPath, mask, pattern, marker,
 * gradients, filter, metadata), or a <text> with characters in it. A shape
 * that happens to paint nothing (fill and stroke none) still counts; it is
 * the empty document this exists to catch, and the logo loader's drawable
 * probe remains the judge of pixels.
 */
export function svgDrawsSomething({ bytes }: SafeSvg): boolean {
  const parser = new SaxesParser();
  let hidden = 0;
  let inText = 0;
  let draws = false;
  parser.on("opentag", (tag) => {
    if (hidden > 0 || NEVER_RENDERED.has(tag.name)) {
      hidden += 1;
      return;
    }
    if (tag.name === "text") inText += 1;
    else if (GRAPHICS.has(tag.name)) draws = true;
  });
  parser.on("closetag", (tag) => {
    if (hidden > 0) hidden -= 1;
    else if (tag.name === "text") inText -= 1;
  });
  const onText = (value: string) => {
    if (hidden === 0 && inText > 0 && value.trim() !== "") draws = true;
  };
  parser.on("text", onText);
  parser.on("cdata", onText);
  parser.write(new TextDecoder().decode(bytes)).close();
  return draws;
}

/* sanitizeSvg writes SVG elements unprefixed, so names compare as is. */
const GRAPHICS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "image",
  "use",
]);

const NEVER_RENDERED = new Set([
  "defs",
  "symbol",
  "clipPath",
  "mask",
  "pattern",
  "marker",
  "linearGradient",
  "radialGradient",
  "filter",
  "metadata",
  "title",
  "desc",
  "style",
]);
