/**
 * What a design-image upload may be, shared by the browser (which normalises
 * before upload), the presign route (which checks the claim) and the loader
 * (which checks the real bytes at generation). Framework-free and free of
 * storage imports so the browser bundle can use it.
 */

/* Every message telling the user an image is unusable starts with this, from
   the browser normaliser and from the server loader alike, so the UI detects
   the state by this constant rather than by its own copy of the wording. */
export const IMAGE_NOT_USABLE_PREFIX = "This image can't be used";

export const MAX_DESIGN_IMAGE_BYTES = 20 * 1024 * 1024;

/* The browser normalises to this long edge. The server cap is looser so a
   client that skipped normalisation still works within what resvg rasterises
   comfortably inside a lambda, and anything beyond is refused outright. */
export const NORMALISED_LONG_EDGE = 2560;
export const MAX_DESIGN_IMAGE_SIDE = 4096;

/* WEBP is accepted from the user but never stored: satori cannot draw it, so
   the browser converts it to PNG or JPEG before asking to upload. */
export const DESIGN_IMAGE_INPUT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const DESIGN_IMAGE_STORED_TYPES = ["image/png", "image/jpeg"] as const;
export type DesignImageStoredType = (typeof DESIGN_IMAGE_STORED_TYPES)[number];
export type DesignImageExtension = "png" | "jpg";

/** The `accept` attribute for the file input, so the picker filters too. */
export const DESIGN_IMAGE_ACCEPT = [
  ...DESIGN_IMAGE_INPUT_TYPES,
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
].join(",");

export const DESIGN_IMAGE_SUMMARY = "PNG, JPEG or WEBP, up to 20 MB";

export const EXTENSION_FOR_STORED_TYPE: Record<
  DesignImageStoredType,
  DesignImageExtension
> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

const STORED_EXTENSIONS: Record<DesignImageStoredType, string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
};

export function isStoredDesignImageType(
  mimeType: string,
): mimeType is DesignImageStoredType {
  return (DESIGN_IMAGE_STORED_TYPES as readonly string[]).includes(mimeType);
}

/** Extension AND MIME must agree, the same contract isAllowedUpload holds. */
export function isPresignableDesignImage(
  fileName: string,
  mimeType: string,
): boolean {
  const mime = mimeType.toLowerCase().trim();
  if (!isStoredDesignImageType(mime)) return false;
  const parts = fileName.toLowerCase().split(".");
  if (parts.length < 2) return false;
  return STORED_EXTENSIONS[mime].includes(parts.pop() ?? "");
}

/** The name the browser gives a normalised blob when it asks to upload it. */
export function uploadFileNameFor(type: DesignImageStoredType): string {
  return `design-image.${EXTENSION_FOR_STORED_TYPE[type]}`;
}
