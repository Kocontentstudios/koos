import { describe, expect, it } from "vitest";
import {
  type BrandSummary,
  brandBlock,
  buildStrategyGenerationPrompt,
} from "@/lib/ai/prompts/strategy";

const BRAND: BrandSummary = {
  name: "Lagos Loom",
  overview: "Handwoven aso-oke bags",
  tone: "Bold, Warm",
  wordsAvoid: "cheap",
};

const GUIDE_BLOCK = [
  "Brand voice guide — every line of copy must obey this:",
  "Always: Lead with the craft",
  "Never: Never say cheap",
].join("\n");

describe("brandBlock", () => {
  it("carries the brand's attributes", () => {
    const block = brandBlock(BRAND);
    expect(block).toContain("Brand: Lagos Loom");
    expect(block).toContain("Tone of voice: Bold, Warm");
    expect(block).toContain("Words to avoid: cheap");
  });

  /* This is the guard that matters. brandBlock feeds six prompts, one of which
     is scored by the paid strategy eval. A brand with no synthesized guide
     must produce exactly the text it produced before the guide existed, so
     adding the feature cannot move those scores. */
  it("is byte-identical for a brand with no voice guide", () => {
    const withoutField = brandBlock(BRAND);
    const withNull = brandBlock({ ...BRAND, voiceGuide: null });
    const withUndefined = brandBlock({ ...BRAND, voiceGuide: undefined });

    expect(withNull).toBe(withoutField);
    expect(withUndefined).toBe(withoutField);
    expect(withoutField).not.toContain("voice guide");
  });

  it("appends the guide when the brand has one", () => {
    const block = brandBlock({ ...BRAND, voiceGuide: GUIDE_BLOCK });

    expect(block).toContain("every line of copy must obey this");
    expect(block).toContain("Never: Never say cheap");
    // Still an addition, not a replacement.
    expect(block).toContain("Brand: Lagos Loom");
  });

  /* The guide is a set of rules, not another attribute, so it must not read as
     one more colon-separated line in the list above it. */
  it("separates the guide from the attribute list", () => {
    const block = brandBlock({ ...BRAND, voiceGuide: GUIDE_BLOCK });
    expect(block).toContain("\n\nBrand voice guide");
  });
});

describe("buildStrategyGenerationPrompt", () => {
  it("carries the guide through to the prompt the generator sees", () => {
    const prompt = buildStrategyGenerationPrompt("some conversation", {
      ...BRAND,
      voiceGuide: GUIDE_BLOCK,
    });
    expect(prompt).toContain("Never: Never say cheap");
  });

  it("is unchanged for a brand without one", () => {
    const withField = buildStrategyGenerationPrompt("some conversation", {
      ...BRAND,
      voiceGuide: null,
    });
    const without = buildStrategyGenerationPrompt("some conversation", BRAND);
    expect(withField).toBe(without);
  });
});

/* brandBlock feeds buildStrategyGenerationPrompt, the one prompt the paid
   eval:strategy suite scores. A new field must contribute nothing at all for a
   brand that never answered, or every baseline shifts. */
describe("websiteUrl is absent by default", () => {
  it("leaves brandBlock byte-identical for a brand with no website", () => {
    expect(brandBlock({ ...BRAND, websiteUrl: null })).toBe(brandBlock(BRAND));
    expect(brandBlock({ ...BRAND, websiteUrl: "" })).toBe(brandBlock(BRAND));
  });

  it("carries the website when the brand has one", () => {
    expect(
      brandBlock({ ...BRAND, websiteUrl: "https://lagosloom.com" }),
    ).toContain("https://lagosloom.com");
  });
});
