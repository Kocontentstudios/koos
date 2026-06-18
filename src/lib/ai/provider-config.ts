// Provider-agnostic AI configuration. One active provider by default
// (AI_PROVIDER / AI_MODEL), with optional per-feature overrides
// (AI_CHAT_PROVIDER / AI_CHAT_MODEL, AI_STRATEGY_PROVIDER / AI_STRATEGY_MODEL).

export type AiFeature = "chat" | "strategy";

export type AiProvider =
  | "zai"
  | "openai"
  | "anthropic"
  | "google"
  | "openai-compatible";

export const AI_PROVIDERS: readonly AiProvider[] = [
  "zai",
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
];

/** Best-effort default model per provider; override with AI_MODEL. */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  zai: "glm-4.6",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-5",
  google: "gemini-2.5-flash",
  "openai-compatible": "",
};

/** The env var holding the API key for each provider. */
export const PROVIDER_KEY_ENV: Record<AiProvider, string> = {
  zai: "ZAI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  "openai-compatible": "AI_COMPATIBLE_API_KEY",
};

export interface ResolvedAi {
  provider: AiProvider;
  model: string;
}

type Env = Record<string, string | undefined>;

export function resolveProviderConfig(
  feature: AiFeature,
  env: Env = process.env,
): ResolvedAi {
  const F = feature.toUpperCase();
  const globalProvider = (env.AI_PROVIDER || "google") as AiProvider;
  const provider = (env[`AI_${F}_PROVIDER`] || globalProvider) as AiProvider;

  // Per-feature model wins. Otherwise the global AI_MODEL applies only when the
  // resolved provider matches the global one — switching provider for a feature
  // without naming a model falls back to that provider's default.
  let model = env[`AI_${F}_MODEL`] || "";
  if (!model && provider === globalProvider) model = env.AI_MODEL || "";
  if (!model) model = DEFAULT_MODELS[provider] ?? "";

  return { provider, model };
}
