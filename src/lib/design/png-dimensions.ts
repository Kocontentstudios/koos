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

/* JPEG states its size in a SOF marker rather than at a fixed offset, so the
   segment chain has to be walked. Worth doing: without it a JPEG from a native
   model has no readable size, and the overlay canvas falls back to our own
   1080 canvas — silently downscaling a 2K render and writing the wrong size to
   the row. */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export function readJpegDimensions(bytes: Uint8Array): PngDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1; // resynchronise on fill bytes
      continue;
    }
    const marker = bytes[offset + 1];
    // Standalone markers carry no length payload.
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / scan data
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    if (SOF_MARKERS.has(marker)) {
      if (offset + 9 > bytes.length) return null;
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      return isPlausibleDimension(width) && isPlausibleDimension(height)
        ? { width, height }
        : null;
    }
    offset += 2 + length;
  }
  return null;
}

/** Size of whichever of the two raster formats the renderer can composite. */
export function readImageDimensions(bytes: Uint8Array): PngDimensions | null {
  return readPngDimensions(bytes) ?? readJpegDimensions(bytes);
}
