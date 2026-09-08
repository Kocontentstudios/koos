/**
 * What an image actually is, read from its bytes.
 *
 * Never from the filename or a client-supplied MIME: a logo is uploaded as
 * .png/.jpg/.svg and the storage key keeps that extension, but the extension
 * is whatever the uploader typed. The bytes are the only honest signal, and
 * the vision model rejects the request outright when the declared type does
 * not match what it decodes.
 */

export const VISION_IMAGE_TYPES = ["png", "jpeg", "webp", "gif"] as const;
export type VisionImageType = (typeof VISION_IMAGE_TYPES)[number];

/** Everything we can recognise, including the ones vision cannot read. */
export type ImageType = VisionImageType | "svg";

export const IMAGE_MIME: Record<ImageType, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

const startsWith = (bytes: Uint8Array, signature: number[]): boolean =>
  signature.every((byte, i) => bytes[i] === byte);

export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  /* RIFF....WEBP — the four size bytes sit between the two markers. */
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return "webp";
  }
  return looksLikeSvg(bytes) ? "svg" : null;
}

/* SVG is text, so there is no magic number. A leading XML declaration, a
   doctype, or a comment may all precede the root element, and the file may be
   UTF-8 BOM'd — so this looks for the tag within the opening bytes rather
   than demanding it first. */
const SVG_SNIFF_BYTES = 1024;

function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, SVG_SNIFF_BYTES))
    .toLowerCase();
  return /<svg[\s>]/.test(head);
}

export function isVisionReadable(
  type: ImageType | null,
): type is VisionImageType {
  return (
    type !== null && (VISION_IMAGE_TYPES as readonly string[]).includes(type)
  );
}
