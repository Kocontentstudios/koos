/**
 * Pixel size read from a PNG's own header.
 *
 * The composite renderer knows its canvas, but the native path returns only
 * bytes — so those rows persisted width/height as null and every surface fell
 * back to a hardcoded 1080. That made the size we show, the aspect box we
 * reserve, and the filename we offer all fiction for exactly the variants the
 * model sized itself.
 *
 * Parsed here rather than with an image library: the answer is 8 bytes at a
 * fixed offset, and the alternative is a native dependency (sharp has failed
 * to install in this environment before) for a value the file states plainly.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR_WIDTH_OFFSET = 16;
const HEADER_BYTES = IHDR_WIDTH_OFFSET + 8;

export interface PngDimensions {
  width: number;
  height: number;
}

const PNG_MAX_DIMENSION = 2 ** 31 - 1;

function isPlausibleDimension(value: number): boolean {
  return value > 0 && value <= PNG_MAX_DIMENSION;
}

export function readPngDimensions(bytes: Uint8Array): PngDimensions | null {
  if (bytes.length < HEADER_BYTES) return null;
  if (PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null;
  // The IHDR chunk is required to come first, so width/height sit at a fixed
  // offset; anything else is not a PNG we produced.
  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(IHDR_WIDTH_OFFSET);
  const height = view.getUint32(IHDR_WIDTH_OFFSET + 4);
  /* Zero is invalid per the spec, and the PNG maximum is 2^31-1. Returning an
     unclamped uint32 would reach an int4 column and fail the UPDATE, marking a
     design that rendered perfectly well as failed and orphaning its upload. */
  if (!isPlausibleDimension(width) || !isPlausibleDimension(height))
    return null;
  return { width, height };
}
