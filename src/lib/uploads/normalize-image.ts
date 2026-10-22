import {
  type PngDimensions,
  readJpegDimensions,
  readPngDimensions,
} from "@/lib/design/png-dimensions";
import { detectImageType } from "@/lib/images/detect";
import {
  type DesignImageStoredType,
  IMAGE_NOT_USABLE_PREFIX,
  MAX_DESIGN_IMAGE_BYTES,
  NO_SUBJECT_REASON,
  NORMALISED_LONG_EDGE,
  TRANSPARENT_IMAGE_REASON,
} from "./design-image-limits";
import {
  looksBlank,
  measureSubject,
  subjectThumbnailSize,
} from "./subject-check";

/**
 * Re-encode a picked image in the browser before it is uploaded.
 *
 * Three jobs in one pass, all of which the server would otherwise pay for or
 * get wrong: WEBP becomes PNG or JPEG because satori cannot draw WEBP; a
 * 7000 px phone photo becomes 2560 px, the bound the server loader fits to
 * anyway, so the upload is no bigger than what will be drawn; and decoding
 * through createImageBitmap applies EXIF orientation and drops EXIF metadata
 * such as location, which a canvas never carries over. A fully transparent
 * image, or a blank or near-uniform one (subject-check.ts), is refused here,
 * before the upload, rather than at generation.
 */

export type ImageNotUsableReason =
  | "wrong_type"
  | "too_large"
  | "too_many_pixels"
  | "undecodable"
  | "encode_failed"
  | "too_large_after_encode"
  | "blank"
  | "no_subject";

const MAX_MB = MAX_DESIGN_IMAGE_BYTES / (1024 * 1024);

const REASONS: Record<ImageNotUsableReason, string> = {
  wrong_type: "it is not a PNG, JPEG or WEBP file. Choose another image.",
  too_large: `it is over ${MAX_MB} MB. Choose a smaller one.`,
  too_many_pixels: "it has too many pixels to open. Choose a smaller one.",
  undecodable:
    "it couldn't be opened and may be damaged. Choose another image.",
  encode_failed:
    "it couldn't be prepared for upload. Try again or choose another image.",
  too_large_after_encode: "it is too detailed to upload. Choose a smaller one.",
  blank: TRANSPARENT_IMAGE_REASON,
  no_subject: NO_SUBJECT_REASON,
};

/** `reason` is for analytics; `message` is safe to show the user. */
export class ImageNotUsableError extends Error {
  constructor(readonly reason: ImageNotUsableReason) {
    super(`${IMAGE_NOT_USABLE_PREFIX}: ${REASONS[reason]}`);
    this.name = "ImageNotUsableError";
  }
}

export interface NormalisedImage {
  blob: Blob;
  type: DesignImageStoredType;
  width: number;
  height: number;
}

type SourceType = "png" | "jpeg" | "webp";

const JPEG_QUALITY = 0.9;

/* Enough to reach a JPEG frame header behind a large EXIF block and an ICC
   profile; PNG and WEBP state their size in the first 30 bytes. */
const HEAD_BYTES = 256 * 1024;

/* A 194 KB PNG can declare 40000 x 40000 pixels, 6.4 GB once decoded. Refused
   from the header before the browser tries. The largest phone sensors shoot
   about 200 MP, but at 100 MP the decoded bitmap is already 400 MB, past what
   a phone browser tab reliably holds. */
export const MAX_SOURCE_PIXELS = 100_000_000;

/* Below the hard cap, a failed decode of a very large image is far likelier a
   browser out of memory than a damaged file, so it is reported as too large
   rather than sending the user to look for damage that is not there. */
export const LIKELY_TOO_BIG_TO_DECODE = 40_000_000;

export async function normalizeImageForUpload(
  file: File,
): Promise<NormalisedImage> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const source = sniffSourceType(head);
  if (file.size > MAX_DESIGN_IMAGE_BYTES) {
    throw new ImageNotUsableError("too_large");
  }
  const declaredPixels = pixelCount(declaredDimensions(head, source));
  if (declaredPixels > MAX_SOURCE_PIXELS) {
    throw new ImageNotUsableError("too_many_pixels");
  }

  const bitmap = await decode(file, declaredPixels);
  try {
    const { width, height } = fitWithinLongEdge(
      bitmap.width,
      bitmap.height,
      NORMALISED_LONG_EDGE,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageNotUsableError("encode_failed");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    const alpha = source === "jpeg" ? OPAQUE : scanAlpha(ctx, width, height);
    if (!alpha.anyVisible) throw new ImageNotUsableError("blank");
    if (hasNoSubject(canvas)) throw new ImageNotUsableError("no_subject");
    const type: DesignImageStoredType = alpha.anyTransparent
      ? "image/png"
      : "image/jpeg";
    if (type === "image/jpeg") flattenOntoWhite(ctx, width, height);

    const blob = await encode(canvas, type);
    if (blob.size > MAX_DESIGN_IMAGE_BYTES) {
      throw new ImageNotUsableError("too_large_after_encode");
    }
    return { blob, type, width, height };
  } finally {
    bitmap.close();
  }
}

/** Scale down (never up) so the longer side is at most `longEdge`. */
export function fitWithinLongEdge(
  width: number,
  height: number,
  longEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/* The bytes, not file.type: the browser derives file.type from the extension,
   so a renamed HEIC or SVG arrives claiming to be image/png. */
function sniffSourceType(head: Uint8Array): SourceType {
  const type = detectImageType(head);
  if (type === "png" || type === "jpeg" || type === "webp") return type;
  throw new ImageNotUsableError("wrong_type");
}

function pixelCount(size: PngDimensions | null): number {
  return size ? size.width * size.height : 0;
}

function declaredDimensions(
  head: Uint8Array,
  source: SourceType,
): PngDimensions | null {
  if (source === "png") return readPngDimensions(head);
  if (source === "jpeg") return readJpegDimensions(head);
  return readWebpDimensions(head);
}

const ascii = (bytes: Uint8Array, from: number, length: number) =>
  String.fromCharCode(...bytes.subarray(from, from + length));

/** A WEBP's canvas size, from whichever of its three headers it uses. */
export function readWebpDimensions(head: Uint8Array): PngDimensions | null {
  if (head.length < 30) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const chunk = ascii(head, 12, 4);
  if (chunk === "VP8X") {
    const uint24 = (at: number) =>
      head[at] | (head[at + 1] << 8) | (head[at + 2] << 16);
    return { width: uint24(24) + 1, height: uint24(27) + 1 };
  }
  if (chunk === "VP8L" && head[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  return null;
}

async function decode(
  file: File,
  declaredPixels: number,
): Promise<ImageBitmap> {
  try {
    return await decodeOriented(file);
  } catch {
    throw new ImageNotUsableError(
      declaredPixels > LIKELY_TOO_BIG_TO_DECODE
        ? "too_many_pixels"
        : "undecodable",
    );
  }
}

/* Engines that predate "from-image" know only "none" and "flipY", and reject
   an unknown option with a TypeError before looking at the file. Retried
   without it: a photo that may come out sideways beats refusing every image
   on that browser. A damaged file rejects with a DOMException instead. */
async function decodeOriented(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    return createImageBitmap(file);
  }
}

interface AlphaScan {
  anyTransparent: boolean;
  anyVisible: boolean;
}

const OPAQUE: AlphaScan = { anyTransparent: false, anyVisible: true };

/* An image keeps PNG when it has even one transparent pixel, whether it
   arrived as PNG or WEBP, so a cut-out sticker keeps its cut-out. An opaque
   one (a screenshot, an export with a flat background) is several times
   larger than the same pixels as JPEG, and nothing is lost by converting it.
   JPEG has no alpha to look for. One with no pixel above alpha 0 draws
   exactly like no image. */
function scanAlpha(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): AlphaScan {
  const { data } = ctx.getImageData(0, 0, width, height);
  let anyTransparent = false;
  let anyVisible = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) anyTransparent = true;
    if (data[i] > 0) anyVisible = true;
    if (anyTransparent && anyVisible) break;
  }
  return { anyTransparent, anyVisible };
}

/* Measured on a thumbnail the browser draws from the full canvas, as the
   server measures one libvips draws from the decoded pixels. The two
   resamplers differ a little; the thresholds leave room for that. */
function hasNoSubject(canvas: HTMLCanvasElement): boolean {
  const size = subjectThumbnailSize(canvas.width, canvas.height);
  const thumb = document.createElement("canvas");
  thumb.width = size.width;
  thumb.height = size.height;
  const ctx = thumb.getContext("2d");
  if (!ctx) return false;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, size.width, size.height);
  const { data } = ctx.getImageData(0, 0, size.width, size.height);
  return looksBlank(measureSubject(data, size.width, size.height));
}

/* A JPEG source is never scanned for alpha, and some engines leave the edges
   of a downscaled drawImage slightly transparent; the JPEG encoder turns that
   into a dark border. Painted behind what is already drawn, so those edges
   land on white instead. */
function flattenOntoWhite(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
}

function encode(
  canvas: HTMLCanvasElement,
  type: DesignImageStoredType,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new ImageNotUsableError("encode_failed")),
      type,
      type === "image/jpeg" ? JPEG_QUALITY : undefined,
    );
  });
}
