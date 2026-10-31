/**
 * Browser-side PNG to JPEG for design downloads (FEAT-033 "JPG").
 *
 * The canvas is filled white before the PNG is drawn: JPEG has no alpha, and
 * an encoder given transparent pixels writes them as black, so a cutout or a
 * rounded logo backing would come out on a black slab.
 */

export const JPEG_QUALITY = 0.92;

export interface PixelSize {
  width: number;
  height: number;
}

export async function pngToJpeg(
  png: Blob,
  size: PixelSize | null,
  quality = JPEG_QUALITY,
): Promise<Blob> {
  const bitmap = await createImageBitmap(png);
  try {
    /* The design's stored size wins over the decoded one so the JPG matches
       what the card says it is, even if a proxy ever served a resized PNG. */
    const width = size?.width ?? bitmap.width;
    const height = size?.height ?? bitmap.height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot convert images.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!jpeg) throw new Error("The JPG could not be created.");
    return jpeg;
  } finally {
    bitmap.close();
  }
}

/** Saves a blob under a name. A blob URL is same-origin, which is the only
 *  case where the `download` attribute is honoured. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  /* Revoked on a delay: some browsers start reading the URL after click()
     returns, and revoking synchronously cancels the save. */
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function jpegFileName(pngFileName: string): string {
  return `${pngFileName.replace(/\.png$/i, "")}.jpg`;
}
