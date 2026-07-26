import { describe, expect, it } from "vitest";
import { buildOnboardingPrompt } from "./onboarding";

describe("buildOnboardingPrompt", () => {
  it("includes known brand context and instructs the model to focus on gaps", () => {
    const p = buildOnboardingPrompt({
      brandProfile: "Acme sells running shoes.",
      audience: "Runners aged 25-40",
      brandVoice: "",
      existingCampaigns: "",
      previousConversations: "",
    });
    expect(p).toContain("Acme sells running shoes.");
    expect(p).toContain("Runners aged 25-40");
    expect(p).toMatch(/gaps/i);
  });

  it("falls back to a placeholder when nothing is known yet", () => {
    const p = buildOnboardingPrompt({
      brandProfile: "",
      audience: "",
      brandVoice: "",
      existingCampaigns: "",
      previousConversations: "",
    });
    expect(p).toContain("Nothing on file yet.");
  });
});
