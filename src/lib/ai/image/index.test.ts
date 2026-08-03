import { describe, expect, it } from "vitest";
import {
  getNativeAdapters,
  getPlateAdapter,
  resolveDesignProviders,
} from "./index";
import { toGoogleAspectRatio, toOpenAiSize } from "./types";

const BEDROCK = {
  AWS_ACCESS_KEY_ID: "ak",
  AWS_SECRET_ACCESS_KEY: "sk",
};

describe("resolveDesignProviders", () => {
  it("returns nothing when no credentials are present", () => {
    expect(resolveDesignProviders({})).toEqual([]);
  });

  it("offers only the plate model when just Bedrock is configured", () => {
    const ids = resolveDesignProviders(BEDROCK).map((a) => a.id);
    expect(ids).toEqual(["bedrock-stability"]);
  });

  it("adds native models as their keys appear", () => {
    const ids = resolveDesignProviders({
      ...BEDROCK,
      GOOGLE_GENERATIVE_AI_API_KEY: "g",
      OPENAI_API_KEY: "o",
    }).map((a) => a.id);
    expect(ids).toEqual(["bedrock-stability", "google", "openai"]);
  });
});

describe("getNativeAdapters", () => {
  it("excludes the plate model, which cannot render text", () => {
    expect(getNativeAdapters(BEDROCK)).toEqual([]);
  });

  it("includes text-capable models when configured", () => {
    const ids = getNativeAdapters({
      GOOGLE_GENERATIVE_AI_API_KEY: "g",
    }).map((a) => a.id);
    expect(ids).toEqual(["google"]);
  });
});

describe("getPlateAdapter", () => {
  it("prefers Bedrock", () => {
    expect(
      getPlateAdapter({
        ...BEDROCK,
        OPENAI_API_KEY: "o",
      })?.id,
    ).toBe("bedrock-stability");
  });

  it("falls back to any configured adapter so plates still render", () => {
    expect(getPlateAdapter({ OPENAI_API_KEY: "o" })?.id).toBe("openai");
  });

  it("returns null rather than throwing when nothing is configured", () => {
    expect(getPlateAdapter({})).toBeNull();
  });
});

describe("aspect ratio normalisation", () => {
  it("substitutes the closest portrait ratio Google supports for 4:5", () => {
    expect(toGoogleAspectRatio("4:5")).toBe("3:4");
    expect(toGoogleAspectRatio("16:9")).toBe("16:9");
  });

  it("maps ratios to OpenAI pixel sizes", () => {
    expect(toOpenAiSize("16:9")).toBe("1536x1024");
    expect(toOpenAiSize("4:5")).toBe("1024x1536");
    expect(toOpenAiSize("1:1")).toBe("1024x1024");
  });
});
