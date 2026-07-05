import { describe, expect, it } from "vitest";
import {
  BRAND_SUGGEST_FIELDS,
  type BrandSuggestContext,
  buildBrandFieldPrompt,
} from "./brand";

const ctx: BrandSuggestContext = {
  name: "KO Skincare",
  overview: "Clean, affordable skincare for young professionals.",
  businessType: "E-commerce / Product",
  stage: "Early (0–50 customers)",
  targetAudience: "",
  offer: "",
  tone: "Friendly & Educational",
  values: "",
  differentiators: "",
  primaryGoal: "Sales / Conversions",
};

describe("BRAND_SUGGEST_FIELDS", () => {
  it("covers exactly the five suggestable fields", () => {
    expect(Object.keys(BRAND_SUGGEST_FIELDS).sort()).toEqual(
      [
        "differentiators",
        "offer",
        "overview",
        "targetAudience",
        "values",
      ].sort(),
    );
  });
});

describe("buildBrandFieldPrompt", () => {
  it("uses SUGGEST mode and includes context when the field is empty", () => {
    const { system, prompt } = buildBrandFieldPrompt({
      field: "targetAudience",
      currentValue: "",
      context: ctx,
    });
    expect(system.toLowerCase()).toContain("suggest");
    // includes the field's human label and brand context
    expect(prompt).toContain(BRAND_SUGGEST_FIELDS.targetAudience.label);
    expect(prompt).toContain("KO Skincare");
  });

  it("uses ENHANCE mode and includes the current draft when the field is set", () => {
    const { system, prompt } = buildBrandFieldPrompt({
      field: "overview",
      currentValue: "we sell face cream",
      context: { ...ctx, overview: "we sell face cream" },
    });
    expect(system.toLowerCase()).toContain("improve");
    expect(prompt).toContain("we sell face cream");
  });
});
