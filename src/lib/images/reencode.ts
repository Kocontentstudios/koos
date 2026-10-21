import sharp, { type Sharp } from "sharp";

/**
 * Decodes an uploaded PNG or JPEG with a strict decoder and writes it out
 * again, so the renderer only ever meets bytes this process encoded.
 *
 * resvg, inside next/og, is no place to meet a hostile file. An indexed PNG
 * whose palette length is not a multiple of three panics it, and a Rust panic
 * aborts the whole Node process: no try/catch contains it, and every other
 * request on the instance dies with it. Dozens more files that are well framed
 * but break a decoder rule it draws as nothing. A structural check cannot copy
 * resvg's decoder rule for rule, so libvips (libpng, libjpeg-turbo) decodes
 * instead, refusing on the first warning, and what goes on is a fresh 8-bit
 * sRGB encode with no metadata.
 *
 * Only PNG and JPEG are ever handed to sharp. librsvg, which sharp uses for
 * SVG, decodes embedded PNGs with the same crate that panics resvg.
 */

export type CleanFormat = "png" | "jpeg";

export interface CleanImage {
  bytes: Buffer;
  width: number;
  height: number;
  /** False when every pixel is fully transparent: drawn, it leaves the slot
   *  exactly as empty as no image at all. */
  visible: boolean;
}

export interface ReencodeOptions {
  /** Refused from the header, before any pixel is decoded. */
  maxInputPixels: number;
  /** The output is scaled down to fit inside this square when larger. */
  maxOutputSide?: number;
}

export class UndecodableImageError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(reason, options);
    this.name = "UndecodableImageError";
  }
}

/* Visually lossless at the long edges the renderer draws, and 4:4:4 keeps a
   red edge or a thin coloured rule from bleeding into its neighbours. */
const JPEG_QUALITY = 92;

const RGBA_CHANNELS = 4;

export async function reencodeImage(
  input: Uint8Array,
  format: CleanFormat,
  options: ReencodeOptions,
): Promise<CleanImage> {
  try {
    return await reencode(input, format, options);
  } catch (err) {
    if (err instanceof UndecodableImageError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new UndecodableImageError(reason, { cause: err });
  }
}

async function reencode(
  input: Uint8Array,
  format: CleanFormat,
  { maxInputPixels, maxOutputSide }: ReencodeOptions,
): Promise<CleanImage> {
  const source = sharp(input, {
    failOn: "warning",
    limitInputPixels: maxInputPixels,
  });
  /* libvips picks its loader by sniffing, and a PNG carrying "<svg" in an
     early text chunk must not be the file that reaches librsvg. */
  const { format: decodedAs, hasAlpha } = await source.metadata();
  if (decodedAs !== format) {
    throw new UndecodableImageError(
      `expected ${format}, decoded as ${decodedAs}`,
    );
  }

  let pixels = source.autoOrient().toColourspace("srgb");
  if (maxOutputSide) {
    pixels = pixels.resize({
      width: maxOutputSide,
      height: maxOutputSide,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  if (!hasAlpha) {
    const { data, info } = await encode(pixels, format).toBuffer({
      resolveWithObject: true,
    });
    return {
      bytes: data,
      width: info.width,
      height: info.height,
      visible: true,
    };
  }

  /* Only an image with alpha can be invisible, and answering that needs the
     pixels, so this branch decodes to raw once and encodes from there rather
     than decoding twice. */
  const { data, info } = await pixels
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  /* 8 bits a channel is what toColourspace("srgb") promises; anything else
     would be re-read below as the wrong pixels rather than failing. */
  if (data.length !== info.width * info.height * RGBA_CHANNELS) {
    throw new UndecodableImageError(`unexpected raw size: ${data.length}`);
  }
  const raw = sharp(data, {
    raw: { width: info.width, height: info.height, channels: RGBA_CHANNELS },
  });
  return {
    bytes: await encode(raw, format).toBuffer(),
    width: info.width,
    height: info.height,
    visible: anyAlpha(data),
  };
}

function encode(pipeline: Sharp, format: CleanFormat): Sharp {
  return format === "png"
    ? pipeline.png()
    : pipeline.jpeg({ quality: JPEG_QUALITY, chromaSubsampling: "4:4:4" });
}

function anyAlpha(rgba: Buffer): boolean {
  for (let i = RGBA_CHANNELS - 1; i < rgba.length; i += RGBA_CHANNELS) {
    if (rgba[i] !== 0) return true;
  }
  return false;
}
