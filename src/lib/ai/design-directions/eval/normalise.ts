import { NORMALISED_LONG_EDGE } from "@/lib/uploads/design-image-limits";

/**
 * A fixture file as the browser normaliser (uploads/normalize-image.ts)
 * would upload it: EXIF orientation applied, fitted within 2560 px, a PNG
 * kept only when something in it is see-through, everything else a JPEG at
 * quality 0.9 flattened onto white. Three of the fixture photos are over
 * the server's 4096 px cap, which only a client that skipped this meets.
 * For the eval and the live script; production never calls it.
 */
export async function normaliseLikeBrowser(
  bytes: Uint8Array,
): Promise<{ bytes: Buffer; type: "png" | "jpeg" }> {
  const { default: sharp } = await import("sharp");
  const fitted = sharp(bytes)
    .rotate()
    .resize(NORMALISED_LONG_EDGE, NORMALISED_LONG_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    });
  const { data, info } = await fitted
    .clone()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let transparent = false;
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i] < 255) {
      transparent = true;
      break;
    }
  }
  if (transparent) return { bytes: await fitted.png().toBuffer(), type: "png" };
  return {
    bytes: await fitted
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90 })
      .toBuffer(),
    type: "jpeg",
  };
}
