import { describe, expect, it } from "vitest";
import { evaluateWelcomeGate } from "@/lib/welcome/gate";

describe("evaluateWelcomeGate", () => {
  it("greets a brand-new user who has not seen it", () => {
    expect(
      evaluateWelcomeGate({
        welcomeSeenAt: null,
        brandOnboardingStatus: null,
      }),
    ).toEqual({ show: true });
  });

  it("greets a user part-way through a draft brand", () => {
    expect(
      evaluateWelcomeGate({
        welcomeSeenAt: null,
        brandOnboardingStatus: "in_progress",
      }).show,
    ).toBe(true);
  });

  it("stays away once the user has acted on it", () => {
    expect(
      evaluateWelcomeGate({
        welcomeSeenAt: new Date("2026-08-29"),
        brandOnboardingStatus: "draft",
      }),
    ).toEqual({ show: false, reason: "already-seen" });
  });

  /* Someone with a finished brand needs no welcome regardless of the column,
     so a backfill gap can never greet an established user. */
  it("stays away from a completed brand even if the column is null", () => {
    expect(
      evaluateWelcomeGate({
        welcomeSeenAt: null,
        brandOnboardingStatus: "completed",
      }),
    ).toEqual({ show: false, reason: "brand-complete" });
  });

  /* The product tour refuses to run while the brand is incomplete, and this
     refuses to run once it is complete. The two cannot overlap. */
  it("is mutually exclusive with the product tour", () => {
    const incomplete = evaluateWelcomeGate({
      welcomeSeenAt: null,
      brandOnboardingStatus: "in_progress",
    });
    const complete = evaluateWelcomeGate({
      welcomeSeenAt: null,
      brandOnboardingStatus: "completed",
    });
    expect(incomplete.show).toBe(true);
    expect(complete.show).toBe(false);
  });
});
