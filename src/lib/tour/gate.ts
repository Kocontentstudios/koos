import { hasCompletedBrand } from "@/lib/brand-profile";

export interface TourGateInput {
  tourCompletedAt: Date | null;
  brandOnboardingStatus: string | null | undefined;
  pathname: string;
  /** ?tour=1 — an explicit replay request from Settings. */
  forced: boolean;
}

export type TourGate =
  | {
      show: false;
      reason: "off-dashboard" | "brand-incomplete" | "already-completed";
    }
  | {
      show: true;
      reason: "first-visit" | "forced";
      startAt: "prompt" | "step";
    };

/**
 * Whether to run the tour, and where to start it.
 *
 * The brand check deliberately precedes the `forced` check: a bookmarked or
 * shared ?tour=1 must never light up a dashboard whose brand isn't built yet.
 */
export function evaluateTourGate(input: TourGateInput): TourGate {
  if (input.pathname !== "/dashboard") {
    return { show: false, reason: "off-dashboard" };
  }
  if (!hasCompletedBrand(input.brandOnboardingStatus)) {
    return { show: false, reason: "brand-incomplete" };
  }
  // A replay skips the prompt — clicking "Replay Tour" already answered it.
  if (input.forced) {
    return { show: true, reason: "forced", startAt: "step" };
  }
  if (input.tourCompletedAt !== null) {
    return { show: false, reason: "already-completed" };
  }
  return { show: true, reason: "first-visit", startAt: "prompt" };
}
