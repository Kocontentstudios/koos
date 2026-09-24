import { ImageResponse } from "next/og";

/**
 * SVG to PNG, so a vector logo can reach a vision model or the design
 * renderer.
 *
 * Bedrock rejects SVG both ways: declared as image/svg+xml the SDK refuses it
 * (AI_UnsupportedFunctionalityError), and declared as image/png the API
 * answers "Could not process image". Since /api/upload accepts image/svg+xml
 * for logos, and a logo is the one asset most likely to BE an SVG, "Pick from
 * logo" silently returned nothing for exactly the brands most likely to use it
 * (KOOS-BUG-014).
 *
 * Uses next/og, which the design renderer already depends on — it bundles
 * satori and resvg, so this adds no dependency.
 */
const RASTER_SIZE = 512;

export interface RasterizeSvgOptions {
  /** Ground the vector is composited onto. The vision path needs an opaque
   * one: a transparent SVG composited on black turns a dark logo invisible and
   * the model reports the background instead of the brand. The design renderer
   * needs the opposite — an opaque ground would paste a white card into the
   * corner of the design (KOOS-BUG-022). */
  background?: string;
  width?: number;
  height?: number;
}

export async function rasterizeSvg(
  bytes: Uint8Array,
  {
    background = "#ffffff",
    width = RASTER_SIZE,
    height = RASTER_SIZE,
  }: RasterizeSvgOptions = {},
): Promise<Uint8Array> {
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(bytes).toString("base64")}`;
  const response = new ImageResponse(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          width: `${width}px`,
          height: `${height}px`,
          background,
        },
        children: {
          type: "img",
          props: { src: dataUri, width, height },
        },
      },
    } as never,
    { width, height },
  );
  // ImageResponse renders lazily inside the stream, so a satori or resvg
  // failure surfaces here rather than at construction.
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The width-to-height ratio an SVG declares, for sizing its raster box so the
 * vector is not squashed into a square.
 *
 * Read from the markup rather than rendered and measured: resvg gives back
 * only the box it was told to draw, so a wrong box is invisible until the logo
 * appears stretched in a finished design. viewBox is preferred over
 * width/height because it survives the responsive `width="100%"` that export
 * tools emit.
 */
/* Anchored to the ROOT <svg> tag. An unanchored match finds the first viewBox
   anywhere in the file, and a <symbol viewBox="0 0 10 10"> inside a 3:1 logo
   then reports the logo as square — a silent 3x vertical stretch. */
const ROOT_TAG = /<svg\b[^>]*>/i;
const VIEW_BOX =
  /\bviewBox\s*=\s*["']\s*([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)\s*["']/;
/* Absolute CSS units are allowed, not just px. A ratio is unitless, so pt, mm,
   in, cm, pc and q are every bit as usable — refusing them told a brand its
   perfectly ordinary Illustrator export was broken. Percentages are excluded
   on purpose: they describe the viewport, not the drawing. */
const WIDTH_ATTR =
  /<svg\b[^>]*?\bwidth\s*=\s*["']\s*([\d.]+)\s*(?:px|pt|pc|mm|cm|in|q)?\s*["']/i;
const HEIGHT_ATTR =
  /<svg\b[^>]*?\bheight\s*=\s*["']\s*([\d.]+)\s*(?:px|pt|pc|mm|cm|in|q)?\s*["']/i;

/* The whole file, not a prefix. A leading window is tempting because an SVG
   root tag is normally first, but exporters emit long <metadata> and <defs>
   blocks ahead of it, and a viewBox past the window reads as "square" — which
   silently squashes a wordmark, because satori's own parser finds the real one
   and disagrees with the box we sized for it. Logos are capped at 5MB by the
   upload route, so reading all of it is cheap. */
function svgText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function rootTag(text: string): string {
  return ROOT_TAG.exec(text)?.[0] ?? "";
}

function declaredSize(text: string): { width: number; height: number } | null {
  const box = VIEW_BOX.exec(rootTag(text));
  if (box) {
    const width = Number(box[3]);
    const height = Number(box[4]);
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return { width, height };
    }
  }
  const width = Number(WIDTH_ATTR.exec(text)?.[1]);
  const height = Number(HEIGHT_ATTR.exec(text)?.[1]);
  if (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    return { width, height };
  }
  return null;
}

export function svgIntrinsicRatio(bytes: Uint8Array): number {
  const size = declaredSize(svgText(bytes));
  return size ? size.width / size.height : 1;
}

/* resvg refuses anything over 32767 on a side, and a viewBox of "0 0 1 100000"
   would otherwise ask for a 600 x 60,000,000 raster. The bound belongs here,
   where the number is derived, not in whatever draws it. */
const MAX_RASTER_SIDE = 4096;

/**
 * The box to rasterise an SVG into, at its own proportions.
 *
 * Both sides are bounded together. Clamping only the height turned a very tall
 * mark into a 600 x 4096 box — a 14x horizontal stretch, silently — because
 * the width stayed at its requested value while the height was cut.
 */
export function svgRasterBox(
  bytes: Uint8Array,
  preferredWidth: number,
): { width: number; height: number } {
  const ratio = svgIntrinsicRatio(bytes);
  let width = preferredWidth;
  let height = width / ratio;

  if (height > MAX_RASTER_SIDE) {
    height = MAX_RASTER_SIDE;
    width = height * ratio;
  }
  if (width > MAX_RASTER_SIDE) {
    width = MAX_RASTER_SIDE;
    height = width / ratio;
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/**
 * Gives an SVG a viewBox when it only declared width and height.
 *
 * satori requires a viewBox and throws without one, so a perfectly ordinary
 * `<svg width="300px" height="100px">` — which every drawing tool emits — was
 * refused outright and the brand was told its logo was broken. The dimensions
 * it did declare are exactly the viewBox it is missing.
 */
export function withViewBox(bytes: Uint8Array): Uint8Array {
  const text = svgText(bytes);
  if (VIEW_BOX.test(rootTag(text))) return bytes;
  const size = declaredSize(text);
  if (!size) return bytes;
  const patched = text.replace(
    /<svg\b/i,
    `<svg viewBox="0 0 ${size.width} ${size.height}"`,
  );
  return new TextEncoder().encode(patched);
}
