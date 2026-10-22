import sharp from "sharp";
import {
  type SubjectThumbnail,
  subjectThumbnail,
} from "@/lib/uploads/subject-check";
import { jpegHasUndrawableFrame } from "./decode-check";

/**
 * Decodes an uploaded PNG or JPEG with a strict decoder and writes it out
 * again, small enough for the renderer to parse, so the renderer only ever
 * meets bytes this process encoded.
 *
 * The renderer is next/og (@vercel/og). It rasterises with sharp, so librsvg
 * and libxml2, whenever sharp is importable, which it always is here (sharp is
 * a direct dependency and next resolves it); only if sharp failed to load
 * would it fall back to resvg-wasm. Neither is a place to meet a hostile file.
 * An indexed PNG whose palette length is not a multiple of three panics the
 * Rust PNG decoder they share, and a Rust panic aborts the whole Node process:
 * no try/catch contains it, and every other request on the instance dies with
 * it. Dozens more files that are well framed but break a decoder rule it draws
 * as nothing. A structural check cannot copy that decoder rule for rule, so
 * libvips (libpng, mozjpeg) decodes instead, refusing on the first warning,
 * and what goes on is a fresh 8-bit sRGB encode with no metadata.
 *
 * Size is the second hazard. satori inlines every image as a base64 data URI
 * in one SVG attribute, and libxml2 refuses an attribute over 10,000,000
 * characters, so an image over RENDERER_MAX_IMAGE_BYTES throws inside the
 * render. The encode is therefore stepped down until it fits a budget below
 * that, and refused only when it cannot fit even at the caller's floor.
 *
 * Only PNG and JPEG are ever handed to sharp. librsvg, which sharp uses for
 * SVG, decodes embedded PNGs with the decoder that panics; SVG goes through
 * sanitizeSvg instead.
 */

/* Every image this process meets is a fresh upload, so libvips' operation
   cache never hits; it only holds each input, and the decoder state behind
   it, for up to 100 operations. Twelve loads of a 4096 px progressive JPEG
   peaked at 1.35 GB with it and 0.53 GB without. Process-wide, which is
   right here too: next/og's renders are each unique as well. */
sharp.cache(false);

export type CleanFormat = "png" | "jpeg";

export interface CleanImage {
  bytes: Buffer;
  width: number;
  height: number;
  /** False when every pixel is fully transparent: drawn, it leaves the slot
   *  exactly as empty as no image at all. */
  visible: boolean;
  /** The subject check's thumbnail of the decoded pixels, when asked for. */
  thumbnail?: SubjectThumbnail;
}

export interface ReencodeOptions {
  /** Refused from the header, before any pixel is decoded. */
  maxInputPixels: number;
  /** The output is scaled down to fit inside this square when larger. */
  maxOutputSide?: number;
  /** Stepping down to meet the byte budget stops at this long edge. */
  minOutputSide: number;
  /** Defaults to RENDERER_IMAGE_BYTE_BUDGET. */
  maxOutputBytes?: number;
  /** Retry once with an end marker appended when a JPEG lacks one. */
  tolerateMissingJpegEnd?: boolean;
  /** Also return the subject check's thumbnail of the decoded pixels. */
  subjectThumbnail?: boolean;
}

/* Measured with next 16.4.1, sharp 0.35.5 (libvips 8.18.7, libxml2 2.15.4):
   an image of this many bytes draws and one byte more throws "Resource limit
   exceeded". 10,000,000 base64 characters, less the data URI prefix. */
export const RENDERER_MAX_IMAGE_BYTES = 7_499_820;

/* About 1 MB under the measured limit, so a libxml2 that counts a little
   differently, or a longer data URI prefix, still parses what we encode. */
export const RENDERER_IMAGE_BYTE_BUDGET = 6_500_000;

export class UndecodableImageError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(reason, options);
    this.name = "UndecodableImageError";
  }
}

/** A JPEG coded in a way browsers do not draw (see jpegHasUndrawableFrame). */
export class UnsupportedJpegError extends UndecodableImageError {
  constructor() {
    super("JPEG frame is not baseline, extended or progressive Huffman");
    this.name = "UnsupportedJpegError";
  }
}

/** Decodable, but too dense to fit the byte budget even at the floor. */
export class ImageOverBudgetError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ImageOverBudgetError";
  }
}

/* Visually lossless at the long edges the renderer draws, and 4:4:4 keeps a
   red edge or a thin coloured rule from bleeding into its neighbours. The
   lower steps are only reached by a JPEG over the byte budget, which at 2560
   px takes noise-like content that hides the loss. */
const JPEG_QUALITY_STEPS = [92, 82, 72] as const;

/* Each step aims just under the budget from the last size, assuming bytes
   scale with pixel count, and always shrinks by at least 10%. */
const STEP_AIM = 0.95;
const STEP_MIN_RATIO = 0.5;
const STEP_MAX_RATIO = 0.9;

/* Bounds the work a hostile file can buy. Three JPEG qualities and three size
   steps; a PNG almost always fits on its second encode. */
const MAX_ENCODES = 6;

const RGB_CHANNELS = 3;
const RGBA_CHANNELS = 4;
const JPEG_END = Buffer.from([0xff, 0xd9]);

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: typeof RGB_CHANNELS | typeof RGBA_CHANNELS;
}

export async function reencodeImage(
  input: Uint8Array,
  format: CleanFormat,
  options: ReencodeOptions,
): Promise<CleanImage> {
  if (format === "jpeg" && jpegHasUndrawableFrame(input)) {
    throw new UnsupportedJpegError();
  }
  try {
    return await reencodeOnce(input, format, options);
  } catch (err) {
    if (!(err instanceof UndecodableImageError)) throw err;
    if (!canRetryWithJpegEnd(input, format, options)) throw err;
    return reencodeOnce(
      Buffer.concat([input, JPEG_END]),
      format,
      options,
    ).catch((retryErr: unknown) => {
      throw retryErr instanceof ImageOverBudgetError ? retryErr : err;
    });
  }
}

/* A JPEG whose scan is complete but whose end marker is missing is drawn in
   full by every browser, and mozjpeg reports it as a premature end. Appending
   the marker is exact for that file; one cut off mid-scan still fails the
   strict decode on the retry, as "Corrupt JPEG data". */
function canRetryWithJpegEnd(
  input: Uint8Array,
  format: CleanFormat,
  { tolerateMissingJpegEnd }: ReencodeOptions,
): boolean {
  if (!tolerateMissingJpegEnd || format !== "jpeg" || input.length < 2) {
    return false;
  }
  return !Buffer.from(input.subarray(-2)).equals(JPEG_END);
}

async function reencodeOnce(
  input: Uint8Array,
  format: CleanFormat,
  options: ReencodeOptions,
): Promise<CleanImage> {
  try {
    const raw = await decodeToRaw(input, format, options);
    const encoded = await encodeWithinBudget(raw, format, options);
    return {
      ...encoded,
      visible: raw.channels === RGB_CHANNELS || anyAlpha(raw.data),
      ...(options.subjectThumbnail && {
        thumbnail: subjectThumbnail(
          raw.data,
          raw.width,
          raw.height,
          raw.channels,
        ),
      }),
    };
  } catch (err) {
    if (
      err instanceof UndecodableImageError ||
      err instanceof ImageOverBudgetError
    ) {
      throw err;
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new UndecodableImageError(reason, { cause: err });
  }
}

async function decodeToRaw(
  input: Uint8Array,
  format: CleanFormat,
  { maxInputPixels, maxOutputSide }: ReencodeOptions,
): Promise<RawImage> {
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
  pixels = hasAlpha ? pixels.ensureAlpha() : pixels.removeAlpha();

  /* Decoded once to raw: the alpha check needs the pixels, and every encode
     attempt below starts from them rather than decoding the file again. */
  const { data, info } = await pixels
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = hasAlpha ? RGBA_CHANNELS : RGB_CHANNELS;
  /* 8 bits a channel is what toColourspace("srgb") promises; anything else
     would be re-read below as the wrong pixels rather than failing. */
  if (data.length !== info.width * info.height * channels) {
    throw new UndecodableImageError(`unexpected raw size: ${data.length}`);
  }
  return { data, width: info.width, height: info.height, channels };
}

interface EncodeStep {
  quality: number;
  width: number;
  height: number;
}

/* The next, smaller encode after one of `bytes` came out over budget, or the
   reason there is none. */
function nextStep(
  step: EncodeStep,
  bytes: number,
  raw: RawImage,
  format: CleanFormat,
  {
    minOutputSide,
    maxOutputBytes,
  }: Required<Pick<ReencodeOptions, "minOutputSide" | "maxOutputBytes">>,
): EncodeStep | string {
  if (format === "jpeg" && step.quality < JPEG_QUALITY_STEPS.length - 1) {
    return { ...step, quality: step.quality + 1 };
  }
  const longEdge = Math.max(step.width, step.height);
  if (longEdge <= minOutputSide) return `the floor is ${minOutputSide}`;
  const ratio = Math.min(
    STEP_MAX_RATIO,
    Math.max(STEP_MIN_RATIO, Math.sqrt(maxOutputBytes / bytes) * STEP_AIM),
  );
  const nextLongEdge = Math.max(minOutputSide, Math.floor(longEdge * ratio));
  const scale = nextLongEdge / Math.max(raw.width, raw.height);
  return {
    quality: step.quality,
    width: Math.max(1, Math.round(raw.width * scale)),
    height: Math.max(1, Math.round(raw.height * scale)),
  };
}

async function encodeWithinBudget(
  raw: RawImage,
  format: CleanFormat,
  {
    minOutputSide,
    maxOutputBytes = RENDERER_IMAGE_BYTE_BUDGET,
  }: ReencodeOptions,
): Promise<{ bytes: Buffer; width: number; height: number }> {
  const limits = { minOutputSide, maxOutputBytes };
  let step = await skipPredictedOverruns(raw, format, limits);
  for (let attempt = 1; ; attempt += 1) {
    const bytes = await encodeAt(raw, step, format);
    if (bytes.length <= maxOutputBytes) {
      return { bytes, width: step.width, height: step.height };
    }
    const out = `${bytes.length} bytes at ${step.width}x${step.height}`;
    if (attempt >= MAX_ENCODES) {
      throw new ImageOverBudgetError(`${out} after ${attempt} encodes`);
    }
    const next = nextStep(step, bytes.length, raw, format, limits);
    if (typeof next === "string") {
      throw new ImageOverBudgetError(`${out}, ${next}`);
    }
    step = next;
  }
}

/* A full encode of a dense 2560 px image costs 0.5 to 1.4 s, and one that
   comes out over budget is thrown away. Encoding a few evenly spaced bands of
   rows predicts the full size to within 4% (real cutouts, photos, noise) for
   a tenth of the work, so the steps a prediction shows to be well over budget
   are walked on predictions, and only the step that should fit is encoded in
   full. The full encode still decides: a prediction never refuses and never
   accepts. Only steps at the decoded size are predicted, since the bands
   would have to be resized to predict a smaller one. */
const SAMPLE_BANDS = 8;
const SAMPLE_BAND_ROWS = 32;
const MIN_ROWS_TO_SAMPLE = 4 * SAMPLE_BANDS * SAMPLE_BAND_ROWS;
const PREDICTION_DOUBT = 1.15;

async function skipPredictedOverruns(
  raw: RawImage,
  format: CleanFormat,
  limits: Required<Pick<ReencodeOptions, "minOutputSide" | "maxOutputBytes">>,
): Promise<EncodeStep> {
  let step: EncodeStep = { quality: 0, width: raw.width, height: raw.height };
  if (raw.height < MIN_ROWS_TO_SAMPLE) return step;
  const sample = sampleBands(raw);
  while (step.width === raw.width && step.height === raw.height) {
    const sampled = await encodeAt(
      sample,
      { quality: step.quality, width: sample.width, height: sample.height },
      format,
    );
    const predicted = (sampled.length * raw.height) / sample.height;
    if (predicted <= limits.maxOutputBytes * PREDICTION_DOUBT) break;
    const next = nextStep(step, predicted, raw, format, limits);
    if (typeof next === "string") break;
    step = next;
  }
  return step;
}

function sampleBands(raw: RawImage): RawImage {
  const rowBytes = raw.width * raw.channels;
  const bands: Buffer[] = [];
  for (let i = 0; i < SAMPLE_BANDS; i += 1) {
    const centre = Math.floor(((i + 0.5) * raw.height) / SAMPLE_BANDS);
    const start = Math.min(
      raw.height - SAMPLE_BAND_ROWS,
      Math.max(0, centre - SAMPLE_BAND_ROWS / 2),
    );
    bands.push(
      raw.data.subarray(
        start * rowBytes,
        (start + SAMPLE_BAND_ROWS) * rowBytes,
      ),
    );
  }
  return {
    data: Buffer.concat(bands),
    width: raw.width,
    height: SAMPLE_BANDS * SAMPLE_BAND_ROWS,
    channels: raw.channels,
  };
}

async function encodeAt(
  raw: RawImage,
  { width, height, quality }: EncodeStep,
  format: CleanFormat,
): Promise<Buffer> {
  let pipeline = sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: raw.channels },
  });
  if (width !== raw.width || height !== raw.height) {
    pipeline = pipeline.resize(width, height, { fit: "fill" });
  }
  /* Filtered, as a browser writes PNG: a photographic cutout comes out a fifth
     to a third smaller than unfiltered, so it fits the budget at a larger
     size. zlib level 3 is its fast matcher; level 6 took up to 5 s on smooth
     2560 px images, against 0.6 s here, for 3% smaller files. Huffman
     optimisation is off for JPEG: it buffers every coefficient for a second
     pass, a quarter of the time per encode, and under glibc the freed buffers
     stayed resident, about 90 MB per encode of a 2560 px image (a q100 noise
     JPEG peaked at 536 MB). Pixels are identical; files are 8 to 16% larger. */
  return format === "png"
    ? pipeline.png({ adaptiveFiltering: true, compressionLevel: 3 }).toBuffer()
    : pipeline
        .jpeg({
          quality: JPEG_QUALITY_STEPS[quality],
          chromaSubsampling: "4:4:4",
          optimiseCoding: false,
        })
        .toBuffer();
}

function anyAlpha(rgba: Buffer): boolean {
  for (let i = RGBA_CHANNELS - 1; i < rgba.length; i += RGBA_CHANNELS) {
    if (rgba[i] !== 0) return true;
  }
  return false;
}
