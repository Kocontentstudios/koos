import { describe, expect, it } from "vitest";
import { resolveOnboardingRoute } from "./onboarding-route";

describe("resolveOnboardingRoute", () => {
  it("sends a brand-new user to conversational onboarding", () => {
    expect(
      resolveOnboardingRoute({ canCreateBrand: true, onboardingType: null }),
    ).toBe("/brand/onboarding");
  });

  it("treats undefined the same as no brand row", () => {
    expect(
      resolveOnboardingRoute({
        canCreateBrand: true,
        onboardingType: undefined,
      }),
    ).toBe("/brand/onboarding");
  });

  it("resumes conversational onboarding for a chat-started draft", () => {
    expect(
      resolveOnboardingRoute({
        canCreateBrand: true,
        onboardingType: "conversational",
      }),
    ).toBe("/brand/onboarding");
  });

  it.each(["manual", "document"])(
    "resumes the form for a %s draft",
    (onboardingType) => {
      expect(
        resolveOnboardingRoute({ canCreateBrand: true, onboardingType }),
      ).toBe("/brand/create");
    },
  );

  it("falls back to the form for an onboarding type this build doesn't know", () => {
    expect(
      resolveOnboardingRoute({
        canCreateBrand: true,
        onboardingType: "telepathy",
      }),
    ).toBe("/brand/create");
  });

  it("never offers brand creation to a member who may not create brands", () => {
    for (const onboardingType of [null, "conversational", "manual"]) {
      expect(
        resolveOnboardingRoute({ canCreateBrand: false, onboardingType }),
      ).toBe("/no-brands");
    }
  });
});
