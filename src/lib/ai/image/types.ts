export type ImageAdapterId = "bedrock-stability" | "google" | "openai";

/** Loose env shape so callers and tests can pass a plain object without
 * satisfying all of NodeJS.ProcessEnv. */
export type ImageEnv = Record<string, string | undefined>;

export interface ReferenceImage {
  bytes: Uint8Array;
  contentType: string;
}

export interface ImageGenerationInput {
  prompt: string;
  aspectRatio?: string;
  /** Brand logo and/or prior art. Adapters that cannot accept these must
   * ignore them rather than fail — see supportsReferenceImages. */
  referenceImages?: ReferenceImage[];
}

export interface GeneratedImage {
  bytes: Uint8Array;
  contentType: string;
}

export interface ImageAdapter {
  id: ImageAdapterId;
  label: string;
  model: string;
  /** Whether the model can legibly render supplied copy. False for diffusion
   * plate models, which is why the composite renderer exists. */
  supportsTextRendering: boolean;
  supportsReferenceImages: boolean;
  generate(input: ImageGenerationInput): Promise<GeneratedImage>;
}

export const SUPPORTED_ASPECT_RATIOS = ["1:1", "4:5", "9:16", "16:9"] as const;

export type AspectRatio = (typeof SUPPORTED_ASPECT_RATIOS)[number];

export function isAspectRatio(value: string): value is AspectRatio {
  return (SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(value);
}

/** Google's image models accept a fixed ratio enum that has no 4:5, so the
 * closest portrait ratio is substituted rather than rejecting the request. */
export function toGoogleAspectRatio(ratio: string): string {
  return ratio === "4:5" ? "3:4" : ratio;
}

/** OpenAI's image models size by pixels rather than ratio. */
export function toOpenAiSize(ratio: string): `${number}x${number}` {
  switch (ratio) {
    case "16:9":
      return "1536x1024";
    case "4:5":
    case "9:16":
      return "1024x1536";
    default:
      return "1024x1024";
  }
}
