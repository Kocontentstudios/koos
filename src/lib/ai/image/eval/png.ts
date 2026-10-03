import { readPngDimensions } from "@/lib/design/png-dimensions";

/**
 * Minimal PNG inspection for the design eval.
 *
 * Replaces a `sharp` import. sharp is present in the tree as a transitive
 * dependency of Next, but importing it here made it a declared dependency of
 * the app and twice broke the Vercel build.
 */

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export interface PngSize {
  width: number;
  height: number;
}

export function isPng(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 8)).equals(PNG_SIGNATURE);
}

/** Null rather than throwing, so a surprise JPEG degrades the eval to a
 * reported failure instead of crashing the run mid-way.
 *
 * The parse lives in src/lib/design/png-dimensions.ts because the generation
 * job depends on it; keeping a second copy here meant neither benefited from
 * the other's tests. */
export function readPngSize(bytes: Uint8Array): PngSize | null {
  return readPngDimensions(bytes);
}

/* One definition, shared with the runtime gate (src/lib/design/quality/checks).
   The threshold was measured here first; it now guards real deliveries too, and
   two copies would drift the moment one was retuned. */
import {
  BLANK_MAX_BYTES_PER_PIXEL,
  bytesPerPixel,
} from "@/lib/design/quality/checks";

export { BLANK_MAX_BYTES_PER_PIXEL, bytesPerPixel };

export function looksBlank(bytes: Uint8Array, size: PngSize): boolean {
  return bytesPerPixel(bytes.length, size) < BLANK_MAX_BYTES_PER_PIXEL;
}
