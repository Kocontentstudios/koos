import { describe, expect, it } from "vitest";
import {
  aggregateRender,
  isCropped,
  RENDER_THRESHOLDS,
  type RenderedCase,
  type RenderedDirection,
  renderFailures,
} from "./render-score";

const direction = (
  over: Partial<RenderedDirection> = {},
): RenderedDirection => ({
  caseId: "c",
  index: 0,
  layout: "hero-center",
  failed: null,
  subjectKnown: true,
  overlaps: 0,
  visibleShare: 1,
  edgeShare: 0.5,
  lookTextOverSubject: false,
  lookSubjectCut: false,
  factsStated: 3,
  factsTotal: 3,
  judgeUnsupported: [],
  judgeMissing: [],
  plateLettering: null,
  ...over,
});

const okCase = (
  directions: RenderedDirection[],
  over: Partial<RenderedCase> = {},
): RenderedCase => ({
  caseId: "c",
  expectRefused: false,
  refused: null,
  directions,
  factsCoveredAnywhere: 3,
  factsTotal: 3,
  ...over,
});

describe("aggregateRender", () => {
  it("passes a clean run", () => {
    const totals = aggregateRender([
      okCase([direction(), direction({ index: 1 })]),
      okCase([], { caseId: "blank", expectRefused: true, refused: "blank" }),
    ]);
    expect(renderFailures(totals)).toEqual([]);
    expect(totals.refusalsMade).toBe(1);
  });

  /* Each of the round-2 live critic's defects fails its own metric. */
  it("fails copy on the subject, a dropped fact, an invented claim, a lettered plate and an accepted blank photo", () => {
    const totals = aggregateRender([
      okCase(
        [
          direction({ overlaps: 2, lookTextOverSubject: true }),
          direction({
            index: 1,
            factsStated: 1,
            judgeUnsupported: ["This weekend only"],
            plateLettering: true,
          }),
        ],
        { factsCoveredAnywhere: 2 },
      ),
      okCase([direction()], { caseId: "blank", expectRefused: true }),
    ]);
    const failures = renderFailures(totals).join("; ");
    for (const name of [
      "copy over subject",
      "look: text over subject",
      "brief facts on any direction",
      "brief facts per direction",
      "judge: invented",
      "lettered plates",
      "bad photos refused",
    ]) {
      expect(failures).toContain(name);
    }
  });

  it("counts a refusal of a good photo against the run", () => {
    const totals = aggregateRender([okCase([], { refused: "no_subject" })]);
    expect(renderFailures(totals).join()).toContain("unexpected refusals");
  });

  it("leaves failed directions and unknown subjects out of the shares", () => {
    const totals = aggregateRender([
      okCase([
        direction({ failed: "covered", overlaps: 3 }),
        direction({ index: 1, subjectKnown: false, overlaps: 0 }),
      ]),
    ]);
    expect(totals.failedDirections).toBe(1);
    expect(totals.copyOverSubject).toBe(0);
    expect(totals.subjectKnownShare).toBe(0);
  });
});

describe("isCropped", () => {
  it("is a subject cut by its frame or drawn small", () => {
    expect(isCropped(direction({ visibleShare: 0.9 }))).toBe(true);
    expect(isCropped(direction({ edgeShare: 0.2 }))).toBe(true);
    expect(isCropped(direction())).toBe(false);
    expect(
      isCropped(direction({ subjectKnown: false, visibleShare: 0.1 })),
    ).toBe(false);
  });

  it("holds the thresholds the README states", () => {
    expect(RENDER_THRESHOLDS.maxCopyOverSubject).toBe(0);
    expect(RENDER_THRESHOLDS.minCaseFactCoverage).toBe(1);
  });
});
