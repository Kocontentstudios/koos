import { describe, expect, it } from "vitest";
import { brandExportFilename, toBrandExport } from "./brand-export";

const brand = {
  id: "b1",
  name: "Ada Bakes",
  onboardingStatus: "completed",
  overview: "Artisan sourdough bakery",
  businessType: "Retail",
  stage: "Growth",
  targetAudience: "Home cooks",
  offer: "Weekly bread boxes",
  tone: "Warm",
  primaryGoal: "Grow subscriptions",
  primaryColor: "#8B5E34",
  secondaryColor: null,
  additionalColors: null,
  logoUrl: "https://cdn.example.com/logo.png",
  values: null,
  wordsLove: null,
  wordsAvoid: null,
  hasLogo: true,
  brandStyle: null,
  competitors: null,
  competitorStrengths: null,
  differentiators: null,
  platforms: ["Instagram"],
  primaryPlatform: "Instagram",
  postingFrequency: "3x per week",
  additionalNotes: null,
  helpfulLinks: null,
  createdAt: new Date("2026-01-15T00:00:00Z"),
  updatedAt: new Date("2026-02-01T00:00:00Z"),
} as Parameters<typeof toBrandExport>[0];

describe("toBrandExport", () => {
  it("groups fields into the seven onboarding sections", () => {
    const out = toBrandExport(brand);
    expect(Object.keys(out.sections)).toEqual([
      "basics",
      "audience",
      "personality",
      "visual",
      "competitors",
      "platforms",
      "additional",
    ]);
  });

  it("carries identity and status outside the sections", () => {
    const out = toBrandExport(brand);
    expect(out.id).toBe("b1");
    expect(out.name).toBe("Ada Bakes");
    expect(out.onboardingStatus).toBe("completed");
  });

  /* KOS-V1-BUG-011: the row carries no stored percentage — there is no such
     column — so the export has to derive one. Ada has all of Basics (20),
     Audience (25) and Platforms (15) but only half of Visual Identity (12.5)
     and no Personality. A missing or zeroed score fails this. */
  it("computes the score from the fields, with nothing stored to read", () => {
    expect(brand).not.toHaveProperty("completionPercentage");
    expect(toBrandExport(brand).completionPercentage).toBe(73);
  });

  it("keeps a fully filled brand at 100", () => {
    const out = toBrandExport({
      ...brand,
      secondaryColor: "#FFFFFF",
      brandStyle: "Rustic",
      values: "Honest, local",
      wordsLove: "warm, fresh",
      wordsAvoid: "mass-produced",
    } as Parameters<typeof toBrandExport>[0]);
    expect(out.completionPercentage).toBe(100);
  });

  it("serializes timestamps as ISO strings so the payload is plain JSON", () => {
    const out = toBrandExport(brand);
    expect(out.createdAt).toBe("2026-01-15T00:00:00.000Z");
    expect(out.updatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("keeps null fields rather than dropping them, so gaps stay visible", () => {
    const out = toBrandExport(brand);
    expect(out.sections.personality.values).toBeNull();
  });

  it("puts the logo url in the visual section", () => {
    expect(toBrandExport(brand).sections.visual.logoUrl).toBe(
      "https://cdn.example.com/logo.png",
    );
  });

  it("groups primaryGoal with audience, not basics", () => {
    const out = toBrandExport(brand);
    expect("primaryGoal" in out.sections.basics).toBe(false);
    expect(out.sections.audience.primaryGoal).toBe("Grow subscriptions");
  });
});

describe("brandExportFilename", () => {
  it("slugifies the brand name", () => {
    expect(brandExportFilename({ name: "Ada Bakes" })).toBe(
      "ada-bakes-brand.json",
    );
  });

  it("strips characters that are unsafe in a filename", () => {
    expect(brandExportFilename({ name: "A/B: Test!" })).toBe(
      "a-b-test-brand.json",
    );
  });

  it("falls back when the name slugifies to nothing", () => {
    expect(brandExportFilename({ name: "///" })).toBe("brand.json");
  });
});
