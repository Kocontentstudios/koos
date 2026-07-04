import { describe, expect, it } from "vitest";
import type { brands } from "@/lib/db/schema";
import { brandToFormState } from "./brand-to-form-state";

type Brand = typeof brands.$inferSelect;

// Minimal row factory — only the fields the mapper reads matter.
function row(overrides: Partial<Brand>): Brand {
  return {
    id: "b1",
    userId: "u1",
    name: "Acme",
    onboardingType: "manual",
    onboardingStatus: "completed",
    completionPercentage: 100,
    overview: "We sell things people love.",
    businessType: null,
    stage: null,
    targetAudience: null,
    offer: null,
    tone: null,
    primaryGoal: null,
    primaryColor: null,
    secondaryColor: null,
    additionalColors: null,
    logoUrl: null,
    values: null,
    wordsLove: null,
    wordsAvoid: null,
    hasLogo: null,
    brandStyle: null,
    competitors: null,
    competitorStrengths: null,
    differentiators: null,
    platforms: null,
    primaryPlatform: null,
    postingFrequency: null,
    additionalNotes: null,
    helpfulLinks: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Brand;
}

describe("brandToFormState", () => {
  it("copies core text fields", () => {
    const s = brandToFormState(row({ name: "Acme", overview: "Hello world" }));
    expect(s.name).toBe("Acme");
    expect(s.overview).toBe("Hello world");
  });

  it("maps a known select value directly, leaving the Other field empty", () => {
    const s = brandToFormState(row({ businessType: "SaaS / Digital Product" }));
    expect(s.businessType).toBe("SaaS / Digital Product");
    expect(s.businessTypeOther).toBe("");
  });

  it("routes a custom select value to the Other sentinel + other field", () => {
    const s = brandToFormState(row({ businessType: "Nonprofit collective" }));
    expect(s.businessType).toBe("Other (Specify)");
    expect(s.businessTypeOther).toBe("Nonprofit collective");
  });

  it("uses the Custom sentinel for a non-standard posting frequency", () => {
    const s = brandToFormState(row({ postingFrequency: "2x / month" }));
    expect(s.postingFrequency).toBe("Custom");
    expect(s.postingFrequencyOther).toBe("2x / month");
  });

  it("splits platforms into known selections and a comma-joined Other field", () => {
    const s = brandToFormState(
      row({ platforms: ["Instagram", "Threads", "Bluesky"] }),
    );
    expect(s.platforms).toContain("Instagram");
    expect(s.platforms).toContain("Other");
    expect(s.platforms).not.toContain("Threads");
    expect(s.platformsOther).toBe("Threads, Bluesky");
  });

  it("maps hasLogo boolean to the Yes/No string", () => {
    expect(brandToFormState(row({ hasLogo: true })).hasLogo).toBe("Yes");
    expect(brandToFormState(row({ hasLogo: false })).hasLogo).toBe("No");
    expect(brandToFormState(row({ hasLogo: null })).hasLogo).toBe("");
  });

  it("falls back to default colors when the row has none", () => {
    const s = brandToFormState(row({ primaryColor: null }));
    expect(s.primaryColor).toBe("#138BC8");
  });
});
