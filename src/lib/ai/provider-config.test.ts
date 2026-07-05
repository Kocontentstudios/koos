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

  it("returns an empty model for bedrock (must be set explicitly)", () => {
    expect(resolveProviderConfig("chat", { AI_PROVIDER: "bedrock" })).toEqual({
      provider: "bedrock",
      model: "",
    });
  });

  it("honors an explicit model for bedrock", () => {
    const env = {
      AI_PROVIDER: "bedrock",
      AI_MODEL: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    };
    expect(resolveProviderConfig("chat", env)).toEqual({
      provider: "bedrock",
      model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    });
  });

  it("resolves a per-feature provider/model for the brand feature", () => {
    const env = {
      AI_PROVIDER: "google",
      AI_MODEL: "gemini-2.5-flash",
      AI_BRAND_PROVIDER: "anthropic",
      AI_BRAND_MODEL: "claude-sonnet-4-5",
    };
    expect(resolveProviderConfig("brand", env)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
  });

  it("falls the brand feature back to the global provider/model", () => {
    expect(
      resolveProviderConfig("brand", {
        AI_PROVIDER: "google",
        AI_MODEL: "gemini-2.5-flash",
      }),
    ).toEqual({ provider: "google", model: "gemini-2.5-flash" });
  });
});
