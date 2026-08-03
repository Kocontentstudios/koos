import {
  bedrockStabilityAdapter,
  isBedrockConfigured,
} from "./adapters/bedrock-stability";
import { googleAdapter, isGoogleConfigured } from "./adapters/google";
import { isOpenAiConfigured, openAiAdapter } from "./adapters/openai";
import type { ImageAdapter, ImageEnv } from "./types";

export * from "./types";

interface Registration {
  adapter: ImageAdapter;
  isConfigured: (env: ImageEnv) => boolean;
}

const REGISTRY: Registration[] = [
  { adapter: bedrockStabilityAdapter, isConfigured: isBedrockConfigured },
  { adapter: googleAdapter, isConfigured: isGoogleConfigured },
  { adapter: openAiAdapter, isConfigured: isOpenAiConfigured },
];

/** Adapters whose credentials are actually present. A missing key must degrade
 * the offered routes, never surface a button that 500s on click. */
export function resolveDesignProviders(
  env: ImageEnv = process.env,
): ImageAdapter[] {
  return REGISTRY.filter((r) => r.isConfigured(env)).map((r) => r.adapter);
}

/** Models that render the whole design in one call, logo included. */
export function getNativeAdapters(env: ImageEnv = process.env): ImageAdapter[] {
  return resolveDesignProviders(env).filter((a) => a.supportsTextRendering);
}

/** The model that paints the text-free background for the composite route.
 * Falls back to any configured adapter so a deployment without Bedrock can
 * still produce plates. */
export function getPlateAdapter(
  env: ImageEnv = process.env,
): ImageAdapter | null {
  const available = resolveDesignProviders(env);
  return (
    available.find((a) => a.id === "bedrock-stability") ?? available[0] ?? null
  );
}
