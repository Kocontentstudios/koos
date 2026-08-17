import { describe, expect, it } from "vitest";
import { isAspectRatio, SUPPORTED_ASPECT_RATIOS } from "../types";
import {
  DESIGN_EVAL_CASES,
  EVAL_THRESHOLDS,
  expectedPixelRatio,
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
  it("accounts for the 4:5 substitution rather than expecting 0.8", () => {
    expect(expectedPixelRatio("4:5")).toBeCloseTo(0.75, 5);
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
});
