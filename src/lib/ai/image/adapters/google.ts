import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateImage } from "ai";
import {
  type GeneratedImage,
  type ImageAdapter,
  type ImageEnv,
  type ImageGenerationInput,
  toGoogleAspectRatio,
} from "../types";

const DEFAULT_MODEL = "gemini-3-pro-image-preview";

export function isGoogleConfigured(env: ImageEnv = process.env): boolean {
  return Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY);
}

function resolveModel(): string {
  return process.env.AI_DESIGN_GOOGLE_MODEL || DEFAULT_MODEL;
}

async function generate({
  prompt,
  aspectRatio = "1:1",
  referenceImages,
}: ImageGenerationInput): Promise<GeneratedImage> {
  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  const { image } = await generateImage({
    model: google.image(resolveModel()),
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
  label: "Nano Banana Pro",
  get model() {
    return resolveModel();
  },
  supportsTextRendering: true,
  supportsReferenceImages: true,
  generate,
};
