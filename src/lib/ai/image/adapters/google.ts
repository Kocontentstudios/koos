import { generateImage } from "ai";
import {
  activeGoogleTransport,
  type GoogleEnv,
  googleImageModel,
  isGoogleConfigured,
} from "../../google-transport";
import {
  type GeneratedImage,
  type ImageAdapter,
  type ImageGenerationInput,
  toGoogleAspectRatio,
} from "../types";

/** The GA id. `gemini-3-pro-image-preview` was shut down on Vertex on
 * 2026-06-25 and 404s there; the GA id serves on both surfaces. */
const DEFAULT_MODEL = "gemini-3-pro-image";

export { isGoogleConfigured };

function resolveModel(): string {
  return process.env.AI_DESIGN_GOOGLE_MODEL || DEFAULT_MODEL;
}

/** Surfaced in the UI so a reviewer can tell which transport rendered a
 * variant — the two bill to different places. */
function resolveLabel(env: GoogleEnv = process.env): string {
  return activeGoogleTransport(env) === "vertex"
    ? "Nano Banana Pro (Vertex)"
    : "Nano Banana Pro";
}

/**
 * Nano Banana Pro renders at 1K, 2K or 4K, but only ever returned the 1K
 * default because nothing asked for anything else.
 *
 * `imageConfig` reaches the model verbatim: generateImage builds its own
 * `{ responseModalities, imageConfig }` and spreads the caller's provider
 * options LAST, on both transports. Supplying the aspect ratio here too is
 * deliberate — the caller spread replaces the whole `imageConfig` key, and
 * this path accepts 4:5 natively, so the ratio does not need the 3:4
 * substitution the image-model enum forces on the outer argument.
 *
 * Both provider keys are set because Vertex reads `vertex` and AI Studio reads
 * `google`; each ignores the other's.
 */
function imageConfigFor(aspectRatio: string) {
  const imageConfig = {
    aspectRatio,
    imageSize: resolveImageSize(),
  };
  return { google: { imageConfig }, vertex: { imageConfig } };
}

const IMAGE_SIZES = new Set(["1K", "2K", "4K"]);

/** Validated, and read per call rather than at module scope: an unchecked
 *  typo would make every generation fall back to the default size for the
 *  life of the process, with nothing but a log line to say so. */
function resolveImageSize(): string {
  const configured = process.env.AI_DESIGN_GOOGLE_IMAGE_SIZE?.trim();
  if (configured && !IMAGE_SIZES.has(configured)) {
    console.warn(
      `AI_DESIGN_GOOGLE_IMAGE_SIZE=${configured} is not one of ${[...IMAGE_SIZES].join(", ")}; using 2K.`,
    );
    return "2K";
  }
  return configured || "2K";
}

async function generate({
  prompt,
  aspectRatio = "1:1",
  referenceImages,
}: ImageGenerationInput): Promise<GeneratedImage> {
  const { image } = await generateImage({
    model: googleImageModel(resolveModel()),
    prompt: referenceImages?.length
      ? { images: referenceImages.map((r) => r.bytes), text: prompt }
      : prompt,
    aspectRatio: toGoogleAspectRatio(aspectRatio) as `${number}:${number}`,
    providerOptions: imageConfigFor(aspectRatio),
  });
  return {
    bytes: image.uint8Array,
    contentType: image.mediaType || "image/png",
  };
}

export const googleAdapter: ImageAdapter = {
  id: "google",
  get label() {
    return resolveLabel();
  },
  get model() {
    return resolveModel();
  },
  supportsTextRendering: true,
  supportsReferenceImages: true,
  generate,
};
