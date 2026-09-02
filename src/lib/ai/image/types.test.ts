import { describe, expect, it } from "vitest";
import {
  isAspectRatio,
  SUPPORTED_ASPECT_RATIOS,
  toGoogleAspectRatio,
  toOpenAiSize,
} from "@/lib/ai/image/types";

/* gpt-image-2 accepts 1024x1024, 1536x1024 and 1024x1536 and nothing larger,
   so these ARE the maximum. Pinned so a later edit cannot quietly shrink the
   request — the resulting designs would just be smaller, with nothing failing. */
describe("toOpenAiSize", () => {
  it.each([
    ["16:9", "1536x1024"],
    ["4:5", "1024x1536"],
    ["9:16", "1024x1536"],
    ["1:1", "1024x1024"],
  ])("asks for the largest size supported at %s", (ratio, expected) => {
    expect(toOpenAiSize(ratio)).toBe(expected);
  });

  it("never asks for less than 1024 on either edge", () => {
    for (const ratio of SUPPORTED_ASPECT_RATIOS) {
      const [w, h] = toOpenAiSize(ratio).split("x").map(Number);
      expect(Math.min(w, h)).toBeGreaterThanOrEqual(1024);
    }
  });
});

describe("toGoogleAspectRatio", () => {
  /* The image-model enum has no 4:5, so the closest portrait ratio is
     substituted rather than the request being rejected. */
  it("substitutes the closest portrait ratio for 4:5", () => {
    expect(toGoogleAspectRatio("4:5")).toBe("3:4");
  });

  it.each(["1:1", "9:16", "16:9"])("passes %s through", (ratio) => {
    expect(toGoogleAspectRatio(ratio)).toBe(ratio);
  });
});

describe("isAspectRatio", () => {
  it.each(SUPPORTED_ASPECT_RATIOS)("accepts %s", (ratio) => {
    expect(isAspectRatio(ratio)).toBe(true);
  });

  it.each(["3:4", "", "1:1 ", "21:9"])("rejects %j", (value) => {
    expect(isAspectRatio(value)).toBe(false);
  });
});
