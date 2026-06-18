export interface BrandProfileInput {
  name?: string;
  overview?: string;
  businessType?: string;
  stage?: string;
  targetAudience?: string;
  offer?: string;
  tone?: string;
  primaryGoal?: string;
  primaryColor?: string;
  secondaryColor?: string;
  additionalColors?: string[];
  logoUrl?: string;
}

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
    return typeof v === "string" && v.trim().length > 0;
  }).length;
  return Math.round((filled / REQUIRED_FIELDS.length) * 100);
}

export function hasCompletedBrand(
  onboardingStatus: string | null | undefined,
): boolean {
  return onboardingStatus === "completed";
}
