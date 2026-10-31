import { describe, expect, it } from "vitest";
import type {
  OutlinePoint,
  PlannedOutline,
} from "@/lib/design/sequence/contract";
import { cafePlan } from "@/lib/design/sequence/fixtures";
import {
  approvedAsPlanned,
  deletedLeaks,
  flagRecall,
  ownerTitle,
  withOwnerPoints,
  withPointDeleted,
} from "./lanes";

const pt = (
  id: string,
  role: OutlinePoint["role"],
  point: string,
  weak = false,
): OutlinePoint => ({
  id,
  role,
  title: "T",
  point,
  source: "brief",
  facts: [],
  weak: weak ? { kind: "filler", reason: "Only says when it happens." } : null,
  sig: `sig-${id}`,
});

const OUTLINE: PlannedOutline = {
  kind: "carousel",
  frameCount: 5,
  offering: "cold brew",
  facts: [],
  points: [
    pt("p1", "hook", "Steeped for 18 hours"),
    pt("p2", "body", "For students in Yaba", true),
    pt("p3", "body", "Served over ice"),
    pt("p4", "body", "Saturday 15 November", true),
    pt("p5", "cta", "WhatsApp 0803 555 0142"),
  ],
};

describe("lane AUTO", () => {
  it("sends the planner's outline back untouched", () => {
    const approved = approvedAsPlanned(OUTLINE);
    expect(approved.points.map((p) => p.point)).toEqual(
      OUTLINE.points.map((p) => p.point),
    );
    expect(approved.points[0]).not.toHaveProperty("weak");
  });
});

describe("lane APPROVED", () => {
  it("replaces each flagged point, in frame order, with the pool's next fact", () => {
    const { approved, edits } = withOwnerPoints(OUTLINE, [
      "Owner fact one here",
      "Owner fact two here",
      "Unused",
    ]);
    expect(approved.points.map((p) => p.point)).toEqual([
      "Steeped for 18 hours",
      "Owner fact one here",
      "Served over ice",
      "Owner fact two here",
      "WhatsApp 0803 555 0142",
    ]);
    expect(approved.points[1].source).toBe("user");
    expect(edits.map((e) => e.id)).toEqual(["p2", "p4"]);
  });

  it("leaves flagged points past the pool as planned", () => {
    const { approved, edits } = withOwnerPoints(OUTLINE, ["Only one"]);
    expect(approved.points[3].point).toBe("Saturday 15 November");
    expect(edits).toHaveLength(1);
  });

  it("titles the owner's point by its first words", () => {
    expect(ownerTitle("Each bottle is 350ml and keeps for 5 days")).toBe(
      "Each bottle is 350ml",
    );
    expect(ownerTitle("No sugar added; we put syrup on the side")).toBe(
      "No sugar added",
    );
    expect(ownerTitle("Bring back an empty bottle")).toBe(
      "Bring back an empty",
    );
  });
});

describe("flagRecall", () => {
  it("counts the low-repetition frames code flagged, and names the ones it missed", () => {
    const tally = flagRecall([
      {
        label: "cafe/5",
        outline: OUTLINE,
        frameScores: [
          { frame: 1, repetition: 5 },
          { frame: 2, repetition: 2 },
          { frame: 3, repetition: 1 },
          { frame: 4, repetition: 2 },
          { frame: 5, repetition: 4 },
        ],
      },
    ]);
    expect(tally).toMatchObject({ low: 3, flagged: 2 });
    expect(tally.recall).toBeCloseTo(2 / 3);
    expect(tally.missed).toEqual(["cafe/5 frame 3 (body): Served over ice"]);
  });

  it("is null when the judge scored no frame low", () => {
    expect(flagRecall([]).recall).toBeNull();
  });

  it("reports how many body points are flagged and how often a flag is right", () => {
    const tally = flagRecall([
      {
        label: "cafe/5",
        outline: OUTLINE,
        frameScores: [
          { frame: 1, repetition: 5 },
          { frame: 2, repetition: 2 },
          { frame: 3, repetition: 4 },
          { frame: 4, repetition: 5 },
          { frame: 5, repetition: 4 },
        ],
      },
    ]);
    expect(tally).toMatchObject({ bodyFlagged: 2, bodyPoints: 3 });
    expect(tally.precision).toBeCloseTo(1 / 2);
  });
});

describe("lane DELETE", () => {
  it("deletes the first body point and sends the rest back signed", () => {
    const result = withPointDeleted(OUTLINE, 2);
    expect(result?.deleted.from).toBe("For students in Yaba");
    expect(result?.approved.points.map((p) => p.id)).toEqual([
      "p1",
      "p3",
      "p4",
      "p5",
    ]);
    expect(result?.approved.points.every((p) => p.sig)).toBe(true);
  });

  it("deletes nothing from an outline at its fewest points", () => {
    expect(withPointDeleted(OUTLINE, 5)).toBeNull();
  });
});

describe("deletedLeaks", () => {
  it("finds a frame still making a point the owner replaced", () => {
    const plan = cafePlan();
    const { approved, edits } = withOwnerPoints(
      {
        ...OUTLINE,
        points: OUTLINE.points.map((p, i) =>
          i === 3
            ? { ...p, point: "Pour one at our Yaba bar, sit in with a glass" }
            : p,
        ),
      },
      ["Owner fact one here", "Owner fact two here"],
    );
    expect(deletedLeaks(plan, approved, edits)).toEqual([
      'frame 4 still says "Pour one at our Yaba bar, sit in with a glass"',
    ]);
  });
});
