// Shared brand-create form state. Extracted so both the form component and the
// brandToFormState mapper can import it without an import cycle.

export const STORAGE_KEY = "ko-os:brand-create";

export interface CreateBrandState {
  // Section 1 — Business Basics
  name: string;
  overview: string;
  businessType: string;
  businessTypeOther: string;
  stage: string;
  stageOther: string;
  // Section 2 — Brand Direction
  targetAudience: string;
  offer: string;
  tone: string;
  toneOther: string;
  primaryGoal: string;
  // Section 3 — Brand Personality
  values: string;
  wordsLove: string;
  wordsAvoid: string;
  // Section 4 — Visual Identity
  hasLogo: string; // "", "Yes", "No"
  brandStyle: string;
  brandStyleOther: string;
  primaryColor: string;
  secondaryColor: string;
  additionalColors: string[];
  logoUrl: string;
  // Section 5 — Competitors
  competitors: string;
  competitorStrengths: string;
  differentiators: string;
  // Section 6 — Platforms & Posting
  platforms: string[];
  platformsOther: string;
  primaryPlatform: string;
  postingFrequency: string;
  postingFrequencyOther: string;
  // Section 7 — Anything Else
  additionalNotes: string;
  helpfulLinks: string;
}

export const DEFAULT_STATE: CreateBrandState = {
  name: "",
  overview: "",
  businessType: "",
  businessTypeOther: "",
  stage: "",
  stageOther: "",
  targetAudience: "",
  offer: "",
  tone: "",
  toneOther: "",
  primaryGoal: "",
  values: "",
  wordsLove: "",
  wordsAvoid: "",
  hasLogo: "",
  brandStyle: "",
  brandStyleOther: "",
  /* Empty, not a seeded hex. step-visual renders the same swatch colour as its
     display fallback, so pre-filling here only had the effect of saving brand
     colours the user never chose — which then counted toward the profile
     completion score for a step they never opened. */
  primaryColor: "",
  secondaryColor: "",
  additionalColors: [],
  logoUrl: "",
  competitors: "",
  competitorStrengths: "",
  differentiators: "",
  platforms: [],
  platformsOther: "",
  primaryPlatform: "",
  postingFrequency: "",
  postingFrequencyOther: "",
  additionalNotes: "",
  helpfulLinks: "",
};
