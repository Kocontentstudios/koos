import { detectImageType } from "@/lib/images/detect";
import {
  type DesignImageStoredType,
  MAX_DESIGN_IMAGE_BYTES,
  NORMALISED_LONG_EDGE,
} from "./design-image-limits";

/**
 * Re-encode a picked image in the browser before it is uploaded.
 *
 * Three jobs in one pass, all of which the server would otherwise pay for or
 * get wrong: WEBP becomes JPEG because satori cannot draw WEBP; a 7000 px
 * phone photo becomes 2560 px because resvg rasterises huge images slowly and
 * with a large memory cost inside a lambda; and decoding through
 * createImageBitmap applies EXIF orientation and drops EXIF metadata such as
 * location, which a canvas never carries over.
 */

export type ImageNotUsableReason =
  | "wrong_type"
  | "too_large"
  | "undecodable"
  | "encode_failed"
  | "too_large_after_encode";

const MAX_MB = MAX_DESIGN_IMAGE_BYTES / (1024 * 1024);

const MESSAGES: Record<ImageNotUsableReason, string> = {
  wrong_type: "This file can't be used. Choose a PNG, JPEG or WEBP image.",
  too_large: `This image is over ${MAX_MB} MB. Choose a smaller one.`,
  undecodable:
    "This image couldn't be opened. It may be damaged, so choose another one.",
  encode_failed:
    "This image couldn't be prepared for upload. Try again or choose another one.",
  too_large_after_encode:
    "This image is too detailed to upload. Choose a smaller one.",
};

/** `reason` is for analytics; `message` is safe to show the user. */
export class ImageNotUsableError extends Error {
  constructor(readonly reason: ImageNotUsableReason) {
    super(MESSAGES[reason]);
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
const SNIFF_BYTES = 16;

export async function normalizeImageForUpload(
  file: File,
): Promise<NormalisedImage> {
  const source = await sniffSourceType(file);
  if (file.size > MAX_DESIGN_IMAGE_BYTES) {
    throw new ImageNotUsableError("too_large");
  }

  const bitmap = await decode(file);
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

    const keepPng = source === "png" && hasTransparency(ctx, width, height);
    if (!keepPng) flattenOntoWhite(ctx, width, height);
    const type: DesignImageStoredType = keepPng ? "image/png" : "image/jpeg";

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
async function sniffSourceType(file: File): Promise<SourceType> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const type = detectImageType(head);
  if (type === "png" || type === "jpeg" || type === "webp") return type;
  throw new ImageNotUsableError("wrong_type");
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageNotUsableError("undecodable");
  }
}

/* A PNG stays PNG only when it actually uses its alpha channel. An opaque PNG
   (a screenshot, an export with a flat background) is several times larger
   than the same pixels as JPEG, and nothing is lost by converting it. */
function hasTransparency(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let alpha = 3; alpha < data.length; alpha += 4) {
    if (data[alpha] < 255) return true;
  }
  return false;
}

/* JPEG has no alpha, and a canvas encodes transparent pixels as black. Painted
   behind what is already drawn, so a transparent WEBP sticker lands on white
   rather than on a black box. */
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
