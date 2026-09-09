export type OnboardingRoute =
  | "/brand/onboarding"
  | "/brand/create"
  | "/no-brands";

export interface OnboardingRouteInput {
  canCreateBrand: boolean;
  /** The brand's onboarding_type, or null when the user has no brand row yet. */
  onboardingType: string | null | undefined;
}

/**
 * Where to send someone whose brand isn't finished yet.
 *
 * Conversational onboarding is the default for a brand-new user: the manual
 * form is reachable, but only by explicit choice. Once a brand row exists we
 * resume the path it was started on, so a half-filled form isn't replaced by a
 * chat that can't see the fields already typed.
 */
export function resolveOnboardingRoute({
  canCreateBrand,
  onboardingType,
}: OnboardingRouteInput): OnboardingRoute {
  if (!canCreateBrand) return "/no-brands";
  if (!onboardingType) return "/brand/onboarding";
  // Unknown values come from a newer build writing a type this one hasn't
  // heard of; fall back to the form rather than 500 on an unmapped branch.
  return onboardingType === "conversational"
    ? "/brand/onboarding"
    : "/brand/create";
}
