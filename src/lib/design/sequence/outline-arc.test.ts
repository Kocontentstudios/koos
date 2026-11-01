import { describe, expect, it } from "vitest";
import { settleArc } from "./arc";
import type { ApprovedOutline } from "./contract";
import { CAFE_FACTS, fact } from "./fixtures";
import {
  EMPTY_POINT,
  fixedArcAnswer,
  outlinePool,
  ownedClaims,
  ownerPointKept,
  ownerStatements,
} from "./outline-arc";

const OUTLINE: ApprovedOutline = {
  kind: "carousel",
  points: [
    {
      id: "p1",
      role: "hook",
      title: "A",
      point: "Cold brew at our Yaba bar, ₦2,500 a bottle",
      source: "brief",
    },
    {
      id: "u-1",
      role: "body",
      title: "B",
      point: "Each bottle keeps for 5 days",
      source: "user",
    },
    { id: "p3", role: "body", title: "C", point: EMPTY_POINT, source: "user" },
    {
      id: "p4",
      role: "cta",
      title: "D",
      point: "WhatsApp 0803 555 0142",
      source: "brief",
    },
  ],
};

describe("outline-arc", () => {
  it("makes the approved points the pool, the action's left out, a placeholder written to no claim", () => {
    const pool = outlinePool(OUTLINE, CAFE_FACTS);
    expect(pool.map((p) => p.text)).toEqual([
      OUTLINE.points[0].point,
      "Each bottle keeps for 5 days",
      "",
    ]);
    expect(pool.map((p) => p.source)).toEqual(["brief", "user", "brief"]);
    expect(pool[0].facts.map((n) => CAFE_FACTS[n].text)).toEqual([
      "₦2,500 a bottle",
      "our Yaba bar",
    ]);
  });

  it("holds frame k to point k whatever the model assigned", () => {
    const answer = fixedArcAnswer(
      {
        hookAngle: "model's own",
        spare: [3],
        subjects: [{ name: "x", points: [1, 2] }],
        frames: [3, 3, 1, 2].map((point) => ({
          point,
          title: "t",
          layout: "hero-center" as const,
          showsImage: false,
        })),
      },
      OUTLINE,
    );
    expect(answer.frames.map((f) => f.point)).toEqual([1, 2, 3, 0]);
    expect(answer.hookAngle).toBe(OUTLINE.points[0].point);
    expect(answer.spare).toEqual([]);
  });

  it("takes the owner's words as stated, never the placeholder", () => {
    expect(ownerStatements(OUTLINE)).toEqual(["Each bottle keeps for 5 days"]);
    expect(ownedClaims(OUTLINE)).toEqual([
      "",
      "Each bottle keeps for 5 days",
      "",
      "",
    ]);
  });

  it("keeps an owner's point only while its figures and most of its words stand", () => {
    const beat = (headline: string, subheadline = "") => ({
      headline,
      subheadline,
      cta: "",
      footerLines: [],
    });
    expect(
      ownerPointKept(
        beat("Good for 5 days", "Each bottle keeps that long."),
        "Each bottle keeps for 5 days",
      ),
    ).toBe(true);
    expect(
      ownerPointKept(
        beat("Good for a week", "Each bottle keeps."),
        "Each bottle keeps for 5 days",
      ),
    ).toBe(false);
    expect(
      ownerPointKept(
        beat("Fresh every Saturday"),
        "Each bottle keeps for 5 days",
      ),
    ).toBe(false);
  });
});

describe("settleArc: the hook carries a date, never opening days", () => {
  it("leaves 'Tuesday to Saturday' to the action frame", () => {
    const facts = [
      fact("day", "Tuesday to Saturday"),
      fact("date", "Saturday 15 November"),
    ];
    const pool = [
      { source: "brief" as const, text: "Hand-dyed in Abeokuta", facts: [] },
      { source: "brief" as const, text: "No two pieces alike", facts: [] },
    ];
    const arc = settleArc(
      {
        hookAngle: "Every piece is hand-dyed in Abeokuta",
        spare: [],
        subjects: [],
        frames: [1, 2, 0].map((point) => ({
          point,
          title: "t",
          layout: "hero-center" as const,
          showsImage: false,
        })),
      },
      { pool, facts, kind: "carousel", offeringFact: null, hasImage: false },
    );
    expect(arc.frames[0].facts).toEqual([1]);
    expect(arc.frames[2].facts).toEqual([0]);
  });
});
