import { hasCompletedBrand } from "@/lib/brand-profile";

export interface WelcomeGateInput {
  welcomeSeenAt: Date | null;
  brandOnboardingStatus: string | null | undefined;
}

export type WelcomeGate =
  | { show: false; reason: "brand-complete" | "already-seen" }
  | { show: true };

/**
 * Whether to show the first-run welcome card.
 *
 * Scoped to users who have not finished a brand, which is also what keeps it
 * from colliding with the product tour: evaluateTourGate refuses to run while
 * the brand is incomplete, so the two can never be on screen together.
 *
 * The brand check precedes the seen check on purpose. Someone who already has
 * a brand does not need a welcome no matter what the column says, and putting
 * that first means a backfill gap can never greet an established user.
 */
export function evaluateWelcomeGate(input: WelcomeGateInput): WelcomeGate {
  if (hasCompletedBrand(input.brandOnboardingStatus)) {
    return { show: false, reason: "brand-complete" };
  }
  if (input.welcomeSeenAt !== null) {
    return { show: false, reason: "already-seen" };
  }
  return { show: true };
}
