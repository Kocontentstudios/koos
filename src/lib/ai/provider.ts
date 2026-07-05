import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { type AiFeature, resolveProviderConfig } from "./provider-config";

const ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} for the selected AI provider.`);
  }
  return value;
}

/**
 * Resolve the language model for a feature based on env config. Built lazily
 * (per call) so the module can be imported without a configured provider —
 * configuration errors surface at request time, not import time.
 */
export function getModel(feature: AiFeature): LanguageModel {
  const { provider, model } = resolveProviderConfig(feature);

  if (!model) {
    throw new Error(
      `No AI model configured for "${provider}". Set AI_MODEL or AI_${feature.toUpperCase()}_MODEL.`,
    );
  }

  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: requireEnv("OPENAI_API_KEY") })(model);
    case "anthropic":
      return createAnthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") })(
        model,
      );
    case "google":
      return createGoogleGenerativeAI({
        apiKey: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
      })(model);
    case "zai":
      return createOpenAICompatible({
        name: "zai",
        baseURL: ZAI_BASE_URL,
        apiKey: requireEnv("ZAI_API_KEY"),
      })(model);
    case "openai-compatible":
      return createOpenAICompatible({
        name: process.env.AI_COMPATIBLE_NAME || "compatible",
        baseURL: requireEnv("AI_COMPATIBLE_BASE_URL"),
        apiKey: requireEnv("AI_COMPATIBLE_API_KEY"),
      })(model);
    case "bedrock":
      return createAmazonBedrock({
        region: requireEnv("AWS_REGION"),
        accessKeyId: requireEnv("AWS_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY"),
        ...(process.env.AWS_SESSION_TOKEN
          ? { sessionToken: process.env.AWS_SESSION_TOKEN }
          : {}),
      })(model);
    default:
      throw new Error(`Unknown AI provider: ${provider satisfies never}`);
  }
}
