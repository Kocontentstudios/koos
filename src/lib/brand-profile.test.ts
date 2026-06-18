import { describe, expect, it } from "vitest";
import { brandProfileCompletion, hasCompletedBrand } from "./brand-profile";

describe("brandProfileCompletion", () => {
  it("is 100 when all step-1 required fields present", () => {
    expect(
      brandProfileCompletion({
        name: "Killa",
        overview: "Clean skincare for busy people, simple routines.",
        businessType: "ecommerce",
        stage: "pre_launch",
      }),
    ).toBe(100);
  });
  it("is 0 when nothing filled", () => {
    expect(brandProfileCompletion({})).toBe(0);
  });
  it("is partial (50) when half of the 4 required fields present", () => {
    expect(
      brandProfileCompletion({ name: "Killa", overview: "x".repeat(20) }),
    ).toBe(50);
  });
});
describe("hasCompletedBrand", () => {
  it("true only for completed status", () => {
    expect(hasCompletedBrand("completed")).toBe(true);
    expect(hasCompletedBrand("in_progress")).toBe(false);
    expect(hasCompletedBrand("draft")).toBe(false);
    expect(hasCompletedBrand(null)).toBe(false);
  });
});
