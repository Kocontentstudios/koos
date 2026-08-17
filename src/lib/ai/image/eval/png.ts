/**
 * Minimal PNG inspection for the design eval.
 *
 * Replaces a `sharp` import. sharp is present in the tree as a transitive
 * dependency of Next, but importing it here made it a declared dependency of
 * the app and twice broke the Vercel build. Dimensions live in the PNG header
 * and need no decoder, so the eval reads them directly.
 */

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** IHDR is always the first chunk, so width and height sit at fixed offsets:
 * 8-byte signature + 4-byte length + 4-byte type. */
const WIDTH_OFFSET = 16;
const HEIGHT_OFFSET = 20;

export interface PngSize {
  width: number;
  height: number;
}

export function isPng(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 8)).equals(PNG_SIGNATURE);
}

/** Null rather than throwing, so a surprise JPEG degrades the eval to a
 * reported failure instead of crashing the run mid-way. */
export function readPngSize(bytes: Uint8Array): PngSize | null {
  if (bytes.length < HEIGHT_OFFSET + 4 || !isPng(bytes)) return null;
  const buf = Buffer.from(bytes);
  const width = buf.readUInt32BE(WIDTH_OFFSET);
  const height = buf.readUInt32BE(HEIGHT_OFFSET);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

export function bytesPerPixel(
  byteLength: number,
  { width, height }: PngSize,
): number {
  return byteLength / (width * height);
}

/**
 * A flat frame is a rendering failure that still returns HTTP 200, so the eval
 * has to catch it. PNG compresses uniform colour to almost nothing, which makes
 * compressed density a reliable proxy without decoding pixels.
 *
 * Measured on this project's own output: a solid 1024x1024 PNG is 0.003 B/px,
 * while the least detailed real design (a soft gradient plate) is 0.622 B/px —
 * a 208x gap. The threshold sits between, ~17x above blank and ~12x below the
 * lowest real sample.
 */
export const BLANK_MAX_BYTES_PER_PIXEL = 0.05;

export function looksBlank(bytes: Uint8Array, size: PngSize): boolean {
  return bytesPerPixel(bytes.length, size) < BLANK_MAX_BYTES_PER_PIXEL;
}
