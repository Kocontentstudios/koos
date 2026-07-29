type Env = Record<string, string | undefined>;

export interface ResolvedImageConfig {
  provider: string;
  model: string;
  region: string;
}

export function resolveImageConfig(
  env: Env = process.env,
): ResolvedImageConfig {
  return {
    provider: env.AI_IMAGE_PROVIDER || "bedrock",
    model: env.AI_IMAGE_MODEL || "stability.stable-image-core-v1:1",
    region: env.AI_IMAGE_REGION || "us-west-2",
  };
}
