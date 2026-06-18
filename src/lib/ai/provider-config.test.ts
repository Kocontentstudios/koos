import { describe, expect, it } from "vitest";
import { resolveProviderConfig } from "./provider-config";

describe("resolveProviderConfig", () => {
  it("defaults to google/gemini-2.5-flash when nothing is set", () => {
    expect(resolveProviderConfig("chat", {})).toEqual({
      provider: "google",
      model: "gemini-2.5-flash",
    });
  });

  it("applies the global provider and model to every feature", () => {
    const env = { AI_PROVIDER: "openai", AI_MODEL: "gpt-4o-mini" };
    expect(resolveProviderConfig("chat", env)).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
    });
    expect(resolveProviderConfig("strategy", env)).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
    });
  });

  it("lets a per-feature provider override the global one", () => {
    const env = {
      AI_PROVIDER: "zai",
      AI_MODEL: "glm-4.6",
      AI_STRATEGY_PROVIDER: "anthropic",
    };
    // strategy switches provider; the zai-specific global model does NOT leak
    expect(resolveProviderConfig("strategy", env)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
    // chat stays on the global
    expect(resolveProviderConfig("chat", env)).toEqual({
      provider: "zai",
      model: "glm-4.6",
    });
  });

  it("honors an explicit per-feature model", () => {
    const env = {
      AI_PROVIDER: "zai",
      AI_STRATEGY_PROVIDER: "anthropic",
      AI_STRATEGY_MODEL: "claude-opus-4-1",
    };
    expect(resolveProviderConfig("strategy", env)).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-1",
    });
  });

  it("returns an empty model for openai-compatible (must be set explicitly)", () => {
    expect(
      resolveProviderConfig("chat", { AI_PROVIDER: "openai-compatible" }),
    ).toEqual({ provider: "openai-compatible", model: "" });
  });
});
