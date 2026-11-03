import { describe, expect, it } from "vitest";
import { multiFrameEnabled } from "./multi-frame-flag";

describe("multiFrameEnabled", () => {
  it("is off unless the flag says on", () => {
    expect(multiFrameEnabled({})).toBe(false);
    expect(multiFrameEnabled({ FEATURE_MULTI_FRAME: "" })).toBe(false);
    expect(multiFrameEnabled({ FEATURE_MULTI_FRAME: "0" })).toBe(false);
    expect(multiFrameEnabled({ FEATURE_MULTI_FRAME: "off" })).toBe(false);
  });

  it.each(["1", "true", "on", "yes", " TRUE "])("is on for %s", (value) => {
    expect(multiFrameEnabled({ FEATURE_MULTI_FRAME: value })).toBe(true);
  });
});
