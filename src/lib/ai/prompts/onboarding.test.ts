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

/* KOS-V1-FEAT-013: words-to-avoid, words-you-love and values are all
   extractable and writable, but the interview never asked about them — so
   they only ever landed if a user volunteered them unprompted. */
describe("buildOnboardingPrompt coverage", () => {
  const prompt = buildOnboardingPrompt({
    brandProfile: "Acme",
    audience: "",
    brandVoice: "",
    existingCampaigns: "",
    previousConversations: "",
  });

  it("asks about words to avoid", () => {
    expect(prompt).toMatch(/words and phrases to avoid/i);
  });

  it("still asks about tone", () => {
    expect(prompt).toMatch(/tone and personality/i);
  });

  /* Tone and words-to-avoid still have a prose fallback in chips.ts, so the
     prompt keeps naming their vocabulary; the marker is what decides the
     competitor pair, and prompt-chip-agreement.test.ts pins that. */
  it("names the vocabulary the tone and avoid fallbacks key off", () => {
    expect(prompt).toMatch(/tone, voice, personality/i);
    expect(prompt).toMatch(/words or phrases to avoid/i);
  });

  it("tells KO not to list the options itself", () => {
    expect(prompt).toMatch(/do not list the options yourself/i);
  });
});
