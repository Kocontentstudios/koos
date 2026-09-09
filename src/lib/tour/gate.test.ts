import { describe, expect, it } from "vitest";
import { evaluateTourGate, type TourGateInput } from "./gate";

const ELIGIBLE: TourGateInput = {
  tourCompletedAt: null,
  brandOnboardingStatus: "completed",
  pathname: "/dashboard",
  forced: false,
};

describe("evaluateTourGate", () => {
  it("shows the prompt on a first dashboard visit with a completed brand", () => {
    expect(evaluateTourGate(ELIGIBLE)).toEqual({
      show: true,
      reason: "first-visit",
      startAt: "prompt",
    });
  });

  it("stays hidden once the tour has been resolved", () => {
    expect(
      evaluateTourGate({ ...ELIGIBLE, tourCompletedAt: new Date() }),
    ).toEqual({ show: false, reason: "already-completed" });
  });

  it("stays hidden while the brand is still being built", () => {
    expect(
      evaluateTourGate({ ...ELIGIBLE, brandOnboardingStatus: "in_progress" }),
    ).toEqual({ show: false, reason: "brand-incomplete" });
  });

  it("stays hidden off the dashboard", () => {
    expect(evaluateTourGate({ ...ELIGIBLE, pathname: "/brand" })).toEqual({
      show: false,
      reason: "off-dashboard",
    });
  });

  it("replays for a user who already finished, skipping the prompt", () => {
    expect(
      evaluateTourGate({
        ...ELIGIBLE,
        tourCompletedAt: new Date(),
        forced: true,
      }),
    ).toEqual({ show: true, reason: "forced", startAt: "step" });
  });

  it("refuses a forced replay when the brand is incomplete", () => {
    // Ordering guard: a bookmarked ?tour=1 must not outrank requireBrand's
    // contract and light up a half-built dashboard.
    expect(
      evaluateTourGate({
        ...ELIGIBLE,
        brandOnboardingStatus: "draft",
        forced: true,
      }),
    ).toEqual({ show: false, reason: "brand-incomplete" });
  });
});
