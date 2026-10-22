import { randomUUID } from "node:crypto";
import { readImageDimensions } from "@/lib/design/png-dimensions";
import {
  jpegDecodes,
  jpegHasUndrawableFrame,
  pngDecodes,
} from "@/lib/images/decode-check";
import { detectImageType } from "@/lib/images/detect";
import {
  ImageOverBudgetError,
  type ReencodeOptions,
  reencodeImage,
  UnsupportedJpegError,
} from "@/lib/images/reencode";
import {
  getObjectBytes,
  ObjectTooLargeError,
  STORAGE_PREFIXES,
} from "@/lib/storage";
import {
  type DesignImageExtension,
  type DesignImageStoredType,
  IMAGE_NOT_USABLE_PREFIX,
  MAX_DESIGN_IMAGE_BYTES,
  MAX_DESIGN_IMAGE_SIDE,
  NO_SUBJECT_REASON,
  NORMALISED_LONG_EDGE,
  TRANSPARENT_IMAGE_REASON,
} from "./design-image-limits";
import { looksBlank, measureSubject } from "./subject-check";

/**
 * A user's uploaded design image, read back by key at generation.
 *
 * The browser normalises before upload and the presign route binds the
 * declared type and size, but neither is proof of the bytes: the PUT goes
 * straight from the browser to R2, and a client can skip the normaliser or a
 * PUT can be cut short. This is the one place the real bytes are judged.
 *
 * The guarantee: the bytes this returns were encoded by this process, never
 * the stored file. Cheap checks run first (key, size, type sniff, the 4096 px
 * cap, a JPEG frame browsers draw, then a structural decode check that refuses truncated and corrupt
 * files and decompression bombs without decoding pixels). What passes is then
 * decoded by libvips, refusing on the first decoder warning, and re-encoded as
 * a plain 8-bit sRGB PNG or JPEG of at most 2560 px and 6.5 MB (see
 * reencodeImage). So satori and the rasteriser (sharp/librsvg) never see an
 * uploaded file's own bytes: a file that would abort the renderer process, or
 * that it would draw as nothing, is refused here with the user-facing message
 * instead. A fully transparent image is refused too, since drawn it is
 * indistinguishable from no image, and so is a blank or near-uniform one
 * (subject-check.ts), which would otherwise become the design's hero.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_ONLY = new RegExp(`^${UUID}$`);
const KEY_TAIL = new RegExp(`^${UUID}\\.(png|jpg)$`);

export type DesignImageFault =
  | "foreign_key"
  | "missing"
  | "too_large"
  | "not_png_or_jpeg"
  | "type_mismatch"
  | "unreadable"
  | "too_many_pixels"
  | "too_detailed"
  | "unsupported_jpeg"
  | "blank"
  | "no_subject";

const MAX_MB = MAX_DESIGN_IMAGE_BYTES / (1024 * 1024);

const REASONS: Record<DesignImageFault, string> = {
  foreign_key: "it was not uploaded for this brand. Choose another image.",
  missing: "the upload could not be found. Upload it again.",
  too_large: `it is larger than ${MAX_MB} MB. Choose a smaller image.`,
  not_png_or_jpeg: "it is not a PNG or JPEG file. Choose another image.",
  type_mismatch: "its contents do not match its file type. Upload it again.",
  unreadable: "it could not be read and may be damaged. Choose another image.",
  too_many_pixels: `it is larger than ${MAX_DESIGN_IMAGE_SIDE} px on one side. Choose a smaller image.`,
  too_detailed:
    "it has too much fine detail to place on a design, even scaled down. Choose another image.",
  unsupported_jpeg:
    "it is saved in a kind of JPEG most apps can't open. Save it again as a standard JPEG or PNG.",
  blank: TRANSPARENT_IMAGE_REASON,
  no_subject: NO_SUBJECT_REASON,
};

/* Fitted to the browser normaliser's own bound, so an image is the same size
   whether or not the client normalised it. 1080 is the width of every canvas:
   below it a full-bleed image is visibly upscaled, so an image that only fits
   the byte budget smaller than that is refused. A missing JPEG end marker
   stays a refusal here, unlike a logo: the normaliser always writes one, so
   its absence means a PUT cut short, which "upload it again" fixes. */
export const DESIGN_IMAGE_REENCODE: ReencodeOptions = {
  maxInputPixels: MAX_DESIGN_IMAGE_SIDE * MAX_DESIGN_IMAGE_SIDE,
  maxOutputSide: NORMALISED_LONG_EDGE,
  minOutputSide: 1080,
  subjectThumbnail: true,
};

/** `fault` is for logs and metrics; `message` is safe to show the user. */
export class DesignImageError extends Error {
  constructor(
    readonly fault: DesignImageFault,
    options?: ErrorOptions,
  ) {
    super(`${IMAGE_NOT_USABLE_PREFIX}: ${REASONS[fault]}`, options);
    this.name = "DesignImageError";
  }
}

export interface DesignImage {
  bytes: Buffer;
  contentType: DesignImageStoredType;
  width: number;
  height: number;
}

export function designImageKeyFor(
  brandId: string,
  ext: DesignImageExtension,
): string {
  /* The brand id becomes a path segment, so anything but a UUID could carry a
     slash or a traversal into the key the browser is then allowed to write. */
  if (!UUID_ONLY.test(brandId)) throw new Error("Invalid brand id");
  return `${STORAGE_PREFIXES.designImages}/${brandId}/${randomUUID()}.${ext}`;
}

/* Matches only the exact shape designImageKeyFor produces. Anything looser
   (a nested path, an encoded segment, an uppercase id) is a key this code
   never minted, so it is refused rather than interpreted. */
export function isDesignImageKeyFor(key: string, brandId: string): boolean {
  if (!UUID_ONLY.test(brandId)) return false;
  const prefix = `${STORAGE_PREFIXES.designImages}/${brandId}/`;
  return key.startsWith(prefix) && KEY_TAIL.test(key.slice(prefix.length));
}

export async function loadDesignImage(
  key: string,
  brandId: string,
): Promise<DesignImage> {
  if (!isDesignImageKeyFor(key, brandId)) {
    throw new DesignImageError("foreign_key");
  }
  const bytes = await readCapped(key);

  const type = detectImageType(bytes);
  if (type !== "png" && type !== "jpeg") {
    throw new DesignImageError("not_png_or_jpeg");
  }
  const keyType = key.endsWith(".png") ? "png" : "jpeg";
  if (type !== keyType) throw new DesignImageError("type_mismatch");

  const size = readImageDimensions(bytes);
  if (!size) throw new DesignImageError("unreadable");
  if (
    size.width > MAX_DESIGN_IMAGE_SIDE ||
    size.height > MAX_DESIGN_IMAGE_SIDE
  ) {
    throw new DesignImageError("too_many_pixels");
  }
  if (type === "jpeg" && jpegHasUndrawableFrame(bytes)) {
    throw new DesignImageError("unsupported_jpeg");
  }
  /* After the size cap, so the inflate check never meets a header promising
     more than 4096 x 4096 pixels. */
  const decodes = type === "png" ? await pngDecodes(bytes) : jpegDecodes(bytes);
  if (!decodes) throw new DesignImageError("unreadable");

  const clean = await reencodeOrRefuse(bytes, type);
  if (!clean.visible) throw new DesignImageError("blank");
  if (clean.thumbnail && looksBlank(measureSubject(clean.thumbnail))) {
    throw new DesignImageError("no_subject");
  }

  return {
    bytes: clean.bytes,
    contentType: type === "png" ? "image/png" : "image/jpeg",
    width: clean.width,
    height: clean.height,
  };
}

async function reencodeOrRefuse(bytes: Buffer, type: "png" | "jpeg") {
  try {
    return await reencodeImage(bytes, type, DESIGN_IMAGE_REENCODE);
  } catch (err) {
    if (err instanceof ImageOverBudgetError) {
      throw new DesignImageError("too_detailed", { cause: err });
    }
    if (err instanceof UnsupportedJpegError) {
      throw new DesignImageError("unsupported_jpeg", { cause: err });
    }
    throw new DesignImageError("unreadable", { cause: err });
  }
}

/* Only the faults that are the file's own become DesignImageError. A storage
   outage is rethrown as-is: telling the user to choose another image when R2
   is down would send them to fix something that is not broken. */
async function readCapped(key: string): Promise<Buffer> {
  try {
    return await getObjectBytes(key, { maxBytes: MAX_DESIGN_IMAGE_BYTES });
  } catch (err) {
    if (err instanceof ObjectTooLargeError) {
      throw new DesignImageError("too_large");
    }
    const name = err instanceof Error ? err.name : "";
    if (name === "NoSuchKey" || name === "NotFound") {
      throw new DesignImageError("missing");
    }
    /* A ranged read of a zero-byte object is answered 416, not with an empty
       body: an empty upload is simply not an image. */
    if (name === "InvalidRange") {
      throw new DesignImageError("not_png_or_jpeg");
    }
    throw err;
  }
}
