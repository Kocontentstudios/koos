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
