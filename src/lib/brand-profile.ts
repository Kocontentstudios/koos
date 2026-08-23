export interface BrandProfileInput {
  name?: string | null;
  overview?: string | null;
  businessType?: string | null;
  stage?: string | null;
  targetAudience?: string | null;
  offer?: string | null;
  tone?: string | null;
  primaryGoal?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  additionalColors?: string[] | null;
  logoUrl?: string | null;
}

/** Placeholder name a conversational draft is created with, so the NOT NULL
 *  column has a value before the user has said what the brand is called. */
export const PLACEHOLDER_BRAND_NAME = "Untitled brand";

const REQUIRED_FIELDS: (keyof BrandProfileInput)[] = [
  "name",
  "overview",
  "businessType",
  "stage",
];

/** 0-100 based on the 4 step-1 required fields. */
export function brandProfileCompletion(input: BrandProfileInput): number {
  const filled = REQUIRED_FIELDS.filter((f) => {
    const v = input[f];
    if (typeof v !== "string" || v.trim().length === 0) return false;
    // The placeholder is ours, not something the user told us — counting it
    // would report 25% complete for a draft that knows nothing yet.
    return !(f === "name" && v.trim() === PLACEHOLDER_BRAND_NAME);
  }).length;
  return Math.round((filled / REQUIRED_FIELDS.length) * 100);
}

export function hasCompletedBrand(
  onboardingStatus: string | null | undefined,
): boolean {
  return onboardingStatus === "completed";
}

export type OnboardingStatus = "draft" | "in_progress" | "completed";

export interface OnboardingProgress {
  completionPercentage: number;
  onboardingStatus: OnboardingStatus;
}

/**
 * Progress for a brand after AI-extracted fields are confirmed onto it.
 *
 * Without this the conversational path is a dead end: /api/actions/confirm
 * wrote the fields but left onboardingStatus at "draft", so requireBrand kept
 * bouncing the user back into onboarding no matter how much they told KO.
 */
export function progressAfterFieldWrite(
  merged: BrandProfileInput,
): OnboardingProgress {
  const completionPercentage = brandProfileCompletion(merged);
  if (completionPercentage === 100) {
    return { completionPercentage, onboardingStatus: "completed" };
  }
  return {
    completionPercentage,
    onboardingStatus: completionPercentage > 0 ? "in_progress" : "draft",
  };
}
