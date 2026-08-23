import { describe, expect, it } from "vitest";
import {
  brandProfileCompletion,
  hasCompletedBrand,
  PLACEHOLDER_BRAND_NAME,
  progressAfterFieldWrite,
} from "./brand-profile";

describe("brandProfileCompletion", () => {
  /* A conversational draft is born with a placeholder name purely to satisfy
     the NOT NULL column. Counting it would report a brand that knows nothing
     about itself as 25% complete. */
  it("does not count the placeholder name as a filled field", () => {
    expect(brandProfileCompletion({ name: PLACEHOLDER_BRAND_NAME })).toBe(0);
    expect(
      brandProfileCompletion({ name: `  ${PLACEHOLDER_BRAND_NAME}  ` }),
    ).toBe(0);
  });

  it("counts a real name the conversation supplied", () => {
    expect(brandProfileCompletion({ name: "Killa" })).toBe(25);
  });

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

describe("progressAfterFieldWrite", () => {
  const complete = {
    name: "Lagos Loom",
    overview: "Handwoven aso-oke bags",
    businessType: "Retail",
    stage: "Early-stage",
  };

  it("completes a brand once every required field is captured", () => {
    expect(progressAfterFieldWrite(complete)).toEqual({
      completionPercentage: 100,
      onboardingStatus: "completed",
    });
  });

  it("marks partial capture as in_progress, not completed", () => {
    expect(progressAfterFieldWrite({ name: "Lagos Loom" })).toEqual({
      completionPercentage: 25,
      onboardingStatus: "in_progress",
    });
  });

  /* A conversational brand starts life with only the placeholder name. It
     must stay a draft, or requireBrand would wave a brand nobody described
     through to the dashboard. */
  it("leaves a brand that captured nothing as a draft", () => {
    expect(progressAfterFieldWrite({ name: PLACEHOLDER_BRAND_NAME })).toEqual({
      completionPercentage: 0,
      onboardingStatus: "draft",
    });
  });

  it("treats null columns from a brand row as unfilled", () => {
    expect(progressAfterFieldWrite({ ...complete, overview: null })).toEqual({
      completionPercentage: 75,
      onboardingStatus: "in_progress",
    });
  });
});
