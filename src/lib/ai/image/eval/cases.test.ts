import { describe, expect, it } from "vitest";
import { isAspectRatio, SUPPORTED_ASPECT_RATIOS } from "../types";
import {
  DESIGN_EVAL_CASES,
  EVAL_THRESHOLDS,
  expectedPixelRatio,
  RATIO_TOLERANCE,
} from "./cases";

// Gate lane: the eval itself costs money to run, so its fixtures are checked
// for free here. A malformed case should fail on commit, not halfway through a
// paid run.
describe("design eval cases", () => {
  it("has unique ids", () => {
    const ids = DESIGN_EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only uses aspect ratios the adapter supports", () => {
    for (const c of DESIGN_EVAL_CASES) {
      expect(isAspectRatio(c.aspectRatio)).toBe(true);
    }
  });

  it("covers every supported aspect ratio so a mapping regression is caught", () => {
    const covered = new Set(DESIGN_EVAL_CASES.map((c) => c.aspectRatio));
    for (const ratio of SUPPORTED_ASPECT_RATIOS) {
      expect(covered.has(ratio)).toBe(true);
    }
  });

  it("includes a text-free case for the composite plate route", () => {
    expect(DESIGN_EVAL_CASES.some((c) => c.expectedText === null)).toBe(true);
  });

  it("names the expected copy inside the prompt that must render it", () => {
    for (const c of DESIGN_EVAL_CASES) {
      if (c.expectedText) expect(c.prompt).toContain(c.expectedText);
    }
  });
});

describe("expectedPixelRatio", () => {
  /* The adapter sends the true ratio in imageConfig, which accepts 4:5 and
     overrides the SDK's 3:4 substitution — so the eval must expect what is
     actually served. Pinning 0.75 here is what kept the free lane green while
     the paid run failed on every portrait case. */
  it("expects the ratio that is actually served for 4:5", () => {
    expect(expectedPixelRatio("4:5")).toBeCloseTo(0.8, 5);
  });

  it("passes through ratios Google serves directly", () => {
    expect(expectedPixelRatio("1:1")).toBeCloseTo(1, 5);
    expect(expectedPixelRatio("16:9")).toBeCloseTo(16 / 9, 5);
    expect(expectedPixelRatio("9:16")).toBeCloseTo(9 / 16, 5);
  });
});

describe("thresholds", () => {
  it("demands perfection on the checks that are definitional", () => {
    expect(EVAL_THRESHOLDS.structuralPassRate).toBe(1);
  });

  it("leaves room for model variance on legibility", () => {
    expect(EVAL_THRESHOLDS.textLegibilityPassRate).toBeGreaterThan(0.5);
    expect(EVAL_THRESHOLDS.textLegibilityPassRate).toBeLessThan(1);
  });

  /* The substitution and the true ratio are 0.05 apart, and the tolerance is
     0.03 — so these two expectations cannot both pass, and the eval fails
     silently if this file drifts from the adapter. */
  it("is far enough from the substituted ratio to matter", () => {
    expect(Math.abs(expectedPixelRatio("4:5") - 0.75)).toBeGreaterThan(
      RATIO_TOLERANCE,
    );
  });
});
