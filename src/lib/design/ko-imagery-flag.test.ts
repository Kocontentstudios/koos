import { describe, expect, it } from "vitest";
import { koImageryEnabled } from "./ko-imagery-flag";

describe("koImageryEnabled", () => {
  it("is off unless the flag says on", () => {
    expect(koImageryEnabled({})).toBe(false);
    expect(koImageryEnabled({ FEATURE_KO_IMAGERY: "" })).toBe(false);
    expect(koImageryEnabled({ FEATURE_KO_IMAGERY: "0" })).toBe(false);
    expect(koImageryEnabled({ FEATURE_KO_IMAGERY: "off" })).toBe(false);
  });

  it.each(["1", "true", "on", "yes", " TRUE "])("is on for %s", (value) => {
    expect(koImageryEnabled({ FEATURE_KO_IMAGERY: value })).toBe(true);
  });
});
