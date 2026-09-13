import { describe, expect, it } from "vitest";
import {
  aggregateLogoScores,
  type LogoEvalScore,
  scoreLogoCase,
} from "./logo-score";

const expectLogo = { logo: true, placement: "top-right" as const };
const clean = {
  logoCount: 1,
  corner: "top-right",
  distorted: false,
  overlapsText: false,
};

describe("scoreLogoCase", () => {
  it("passes a single, correctly placed, undistorted mark", () => {
    expect(scoreLogoCase("a", expectLogo, clean)).toEqual({
      id: "a",
      present: true,
      placed: true,
      clean: true,
    });
  });

  /* The reported bug: the design came back with no logo anywhere. */
  it("fails everything when the mark is missing", () => {
    const score = scoreLogoCase("a", expectLogo, {
      ...clean,
      logoCount: 0,
      corner: "",
    });
    expect(score).toMatchObject({
      present: false,
      placed: false,
      clean: false,
    });
  });

  /* Two marks means the image model drew its own beside the one we
     composited — worse than none, because it looks deliberate. */
  it("fails a doubled mark", () => {
    expect(
      scoreLogoCase("a", expectLogo, { ...clean, logoCount: 2 }).present,
    ).toBe(false);
  });

  it("separates a misplaced mark from a distorted one", () => {
    expect(
      scoreLogoCase("a", expectLogo, { ...clean, corner: "bottom-left" }),
    ).toMatchObject({ present: true, placed: false, clean: true });
    expect(
      scoreLogoCase("a", expectLogo, { ...clean, distorted: true }),
    ).toMatchObject({ present: true, placed: true, clean: false });
  });

  it("counts a mark sitting on the copy as unclean", () => {
    expect(
      scoreLogoCase("a", expectLogo, { ...clean, overlapsText: true }).clean,
    ).toBe(false);
  });

  /* A logo-free brief inverts the assertion: any mark at all is the failure. */
  it("inverts for a logo-free case", () => {
    const none = { logo: false, placement: "none" as const };
    expect(
      scoreLogoCase("a", none, { ...clean, logoCount: 0, corner: "" }).present,
    ).toBe(true);
    expect(scoreLogoCase("a", none, clean).present).toBe(false);
  });
});

describe("aggregateLogoScores", () => {
  const score = (over: Partial<LogoEvalScore>): LogoEvalScore => ({
    id: "x",
    present: true,
    placed: true,
    clean: true,
    ...over,
  });

  it("passes a clean sweep", () => {
    expect(aggregateLogoScores([score({}), score({})]).passed).toBe(true);
  });

  /* Presence has no tolerance — one missing logo is the whole ticket. */
  it("fails if a single case lost its logo", () => {
    expect(
      aggregateLogoScores([
        score({}),
        score({ present: false, placed: false, clean: false }),
      ]).passed,
    ).toBe(false);
  });

  it("tolerates one corner drift in five", () => {
    const scores = [
      score({}),
      score({}),
      score({}),
      score({}),
      score({ placed: false }),
    ];
    expect(aggregateLogoScores(scores).placed).toBe(0.8);
    expect(aggregateLogoScores(scores).passed).toBe(true);
  });

  it("tolerates no distortion at all", () => {
    expect(
      aggregateLogoScores([score({}), score({ clean: false })]).passed,
    ).toBe(false);
  });

  it("does not divide by zero on an empty run", () => {
    expect(aggregateLogoScores([])).toMatchObject({
      present: 0,
      passed: false,
    });
  });
});
