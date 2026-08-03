import { createOpenAI } from "@ai-sdk/openai";
import { generateImage } from "ai";
import {
  type GeneratedImage,
  type ImageAdapter,
  type ImageEnv,
  type ImageGenerationInput,
  toOpenAiSize,
} from "../types";

const DEFAULT_MODEL = "gpt-image-2";

export function isOpenAiConfigured(env: ImageEnv = process.env): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

function resolveModel(): string {
  return process.env.AI_DESIGN_OPENAI_MODEL || DEFAULT_MODEL;
}

async function generate({
  prompt,
  aspectRatio = "1:1",
  referenceImages,
}: ImageGenerationInput): Promise<GeneratedImage> {
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { image } = await generateImage({
    model: openai.image(resolveModel()),
    prompt: referenceImages?.length
      ? { images: referenceImages.map((r) => r.bytes), text: prompt }
      : prompt,
    size: toOpenAiSize(aspectRatio),
  });
  return {
    bytes: image.uint8Array,
    contentType: image.mediaType || "image/png",
  };
}

export const openAiAdapter: ImageAdapter = {
  id: "openai",
  label: "GPT Image 2",
  get model() {
    return resolveModel();
  },
  supportsTextRendering: true,
  supportsReferenceImages: true,
  generate,
};
