import type { Tool } from "ai";
import type { AiProvider } from "@/lib/ai/provider-config";
import type { ToolContext } from "./context";
import { buildProposeTools } from "./propose";
import { buildReadTools } from "./read";

export function buildBrandTools(ctx: ToolContext): Record<string, Tool> {
  return { ...buildReadTools(ctx), ...buildProposeTools(ctx) };
}

const TOOL_CAPABLE: ReadonlySet<AiProvider> = new Set<AiProvider>([
  "bedrock",
  "anthropic",
  "openai",
  "google",
]);

export function providerSupportsTools(provider: AiProvider): boolean {
  return TOOL_CAPABLE.has(provider);
}
