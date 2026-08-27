import { describe, expect, it } from "vitest";
import {
  brandProfileCompletion,
  hasCompletedBrand,
  isBasicsComplete,
  PLACEHOLDER_BRAND_NAME,
  parseAdditionalColors,
  progressAfterFieldWrite,
} from "./brand-profile";

const BASICS = {
  name: "Killa",
  overview: "Clean skincare for busy people, simple routines.",
  businessType: "ecommerce",
  stage: "pre_launch",
};

const AUDIENCE = {
  targetAudience: "Busy professionals, 25-40",
  offer: "Monthly subscription box",
  tone: "Warm and direct",
  primaryGoal: "Grow repeat purchases",
};

const VISUAL = {
  logoUrl: "https://example.com/logo.png",
  brandStyle: "Minimal",
  primaryColor: "#0A0A0A",
  secondaryColor: "#F5F5F5",
};

const PERSONALITY = {
  values: "Honest, simple, useful",
  wordsLove: "clean, calm",
  wordsAvoid: "luxury, hype",
};

const PLATFORMS = {
  platforms: ["instagram", "tiktok"],
  primaryPlatform: "instagram",
  postingFrequency: "3x per week",
};

describe("brandProfileCompletion", () => {
  /* A conversational draft is born with a placeholder name purely to satisfy
     the NOT NULL column. Counting it would report a brand that knows nothing
     about itself as complete. */
  it("does not count the placeholder name as a filled field", () => {
    expect(brandProfileCompletion({ name: PLACEHOLDER_BRAND_NAME })).toBe(0);
    expect(
      brandProfileCompletion({ name: `  ${PLACEHOLDER_BRAND_NAME}  ` }),
    ).toBe(0);
  });

  it("is 0 when nothing filled", () => {
    expect(brandProfileCompletion({})).toBe(0);
  });

  /* KOS-V1-BUG-001: this was the whole bug. Filling only the required Basics
     scored 100% and the admin directory reported the brand as finished. */
  it("scores a Basics-only brand at the weight of Basics, not 100", () => {
    expect(brandProfileCompletion(BASICS)).toBe(20);
  });

  it("is 100 only when every scored section is filled", () => {
    expect(
      brandProfileCompletion({
        ...BASICS,
        ...AUDIENCE,
        ...VISUAL,
        ...PERSONALITY,
        ...PLATFORMS,
      }),
    ).toBe(100);
  });

  describe("section weights", () => {
    it.each([
      ["Basics", BASICS, 20],
      ["Audience", AUDIENCE, 25],
      ["Visual Identity", VISUAL, 25],
      ["Personality", PERSONALITY, 15],
      ["Platforms", PLATFORMS, 15],
    ])("awards %s its full weight of %i", (_name, section, weight) => {
      expect(brandProfileCompletion(section)).toBe(weight);
    });

    it("awards partial credit within a section", () => {
      expect(brandProfileCompletion({ name: "Killa" })).toBe(5);
      expect(
        brandProfileCompletion({ name: "Killa", overview: "x".repeat(20) }),
      ).toBe(10);
      expect(brandProfileCompletion({ targetAudience: "Everyone" })).toBe(6);
    });

    it("sums sections", () => {
      expect(brandProfileCompletion({ ...BASICS, ...PLATFORMS })).toBe(35);
    });

    /* The ticket's five weights already total 100, leaving no room for the
       Competitors and Anything Else steps. Both are optional in the form. */
    it("scores nothing for Competitors or Anything Else", () => {
      expect(
        brandProfileCompletion({
          ...BASICS,
          competitors: "Acme",
          competitorStrengths: "Distribution",
          differentiators: "Price",
          additionalNotes: "Anything",
          helpfulLinks: "https://example.com",
        } as Parameters<typeof brandProfileCompletion>[0]),
      ).toBe(20);
    });
  });

  describe("field emptiness", () => {
    it("treats whitespace and nulls as unfilled", () => {
      expect(brandProfileCompletion({ ...BASICS, overview: "   " })).toBe(15);
      expect(brandProfileCompletion({ ...BASICS, stage: null })).toBe(15);
    });

    it("treats an empty array platform list as unfilled", () => {
      expect(brandProfileCompletion({ platforms: [] })).toBe(0);
      expect(brandProfileCompletion({ platforms: ["instagram"] })).toBe(5);
    });
  });
});

describe("isBasicsComplete", () => {
  it("is true only once all four required fields have real values", () => {
    expect(isBasicsComplete(BASICS)).toBe(true);
    expect(isBasicsComplete({ ...BASICS, stage: null })).toBe(false);
    expect(isBasicsComplete({ ...BASICS, name: PLACEHOLDER_BRAND_NAME })).toBe(
      false,
    );
    expect(isBasicsComplete({})).toBe(false);
  });

  it("does not care about the optional sections", () => {
    expect(isBasicsComplete({ ...BASICS, ...AUDIENCE })).toBe(true);
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

  /* The gate that matters. requireBrand redirects anything short of
     "completed" out of the dashboard, so this must stay tied to the required
     Basics fields and NOT to the percentage — a brand with optional sections
     blank now scores 20 and would otherwise be locked out forever. */
  it("completes a brand on the required fields alone, not on the score", () => {
    expect(progressAfterFieldWrite(complete)).toEqual({
      completionPercentage: 20,
      onboardingStatus: "completed",
    });
  });

  it("stays completed as optional sections raise the score", () => {
    expect(progressAfterFieldWrite({ ...complete, ...PLATFORMS })).toEqual({
      completionPercentage: 35,
      onboardingStatus: "completed",
    });
  });

  it("marks partial capture as in_progress, not completed", () => {
    expect(progressAfterFieldWrite({ name: "Lagos Loom" })).toEqual({
      completionPercentage: 5,
      onboardingStatus: "in_progress",
    });
  });

  /* Optional fields alone must not imply the brand is described: the required
     Basics are still missing, so it cannot be waved through to the dashboard. */
  it("stays in_progress when only optional sections were captured", () => {
    expect(progressAfterFieldWrite(AUDIENCE)).toEqual({
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
      completionPercentage: 15,
      onboardingStatus: "in_progress",
    });
  });
});

describe("parseAdditionalColors", () => {
  it("splits, trims and drops empty entries", () => {
    expect(parseAdditionalColors(" #AAA , , #BBB ")).toEqual(["#AAA", "#BBB"]);
  });

  it("returns an array — never the raw string — so the text[] write is safe", () => {
    expect(Array.isArray(parseAdditionalColors(""))).toBe(true);
    expect(parseAdditionalColors("")).toEqual([]);
    expect(parseAdditionalColors(null)).toEqual([]);
    expect(parseAdditionalColors(undefined)).toEqual([]);
  });

  it("caps at 3 even when the model ignores the instruction", () => {
    expect(parseAdditionalColors("a,b,c,d,e")).toEqual(["a", "b", "c"]);
  });

  it("keeps colour names — the AI path stores them, hex is not required", () => {
    expect(parseAdditionalColors("forest green, cream")).toEqual([
      "forest green",
      "cream",
    ]);
  });

  it("de-duplicates case-insensitively", () => {
    expect(parseAdditionalColors("Gold, gold, indigo")).toEqual([
      "Gold",
      "indigo",
    ]);
  });

  it("accepts an array as well as a string", () => {
    expect(parseAdditionalColors(["#AAA", "", "#BBB"])).toEqual([
      "#AAA",
      "#BBB",
    ]);
  });

  it("truncates an absurdly long entry rather than writing it", () => {
    expect(parseAdditionalColors("x".repeat(200))[0]).toHaveLength(40);
  });
});
