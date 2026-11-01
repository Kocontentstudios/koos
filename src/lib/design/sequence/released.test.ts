import { describe, expect, it } from "vitest";
import type { ArcPoint } from "./arc";
import type { ApprovedOutline, PlannedSequence } from "./contract";
import { withFactsDrawn } from "./coverage";
import { beatOf, fact } from "./fixtures";
import { namesFree } from "./hook";
import { factsIn } from "./outline-arc";
import {
  linesOf,
  outlineEdited,
  releasedFacts,
  releasedFaults,
  removedFaults,
  removedPoints,
} from "./removed";
import { factsUncovered, validateSequence } from "./validate";

/* The gym the outline was probed with: the owner deleted p3, the coach
   point, and later corrected the hours from 10pm to 11pm. */
const FACTS = [
  fact("product", "membership"),
  fact("place", "Allen Avenue, Ikeja"),
  fact("time", "5am to 10pm"),
  fact("day", "Every day"),
  fact("price", "Monthly membership is ₦25,000"),
  fact("offer", "Free towel service and a sauna after every session"),
  fact("condition", "A coach is on the floor at all hours to check your form"),
  fact("offer", "Your first week is free"),
  fact("contact", "ironclad.ng/join"),
];
const FREE = namesFree("Ironclad Gym", "membership");
const COACH = "A coach is on the floor at all hours to check your form";
const HOURS = "Ironclad Gym is open 5am to 10pm every day";

const poolPoint = (source: ArcPoint["source"], text: string): ArcPoint => ({
  source,
  text,
  facts: factsIn(text, FACTS),
});

const PLANNED: ArcPoint[] = [
  poolPoint("fact", "Free towel service and a sauna after every session"),
  poolPoint(
    "profile",
    "For office workers in Ikeja who train before or after work",
  ),
  poolPoint("fact", COACH),
  poolPoint("fact", HOURS),
  poolPoint(
    "profile",
    "Every trainer is certified by the Nigeria Fitness Council",
  ),
];

const CTA = {
  role: "cta" as const,
  title: "Join Ironclad today",
  point:
    "Sign up at ironclad.ng/join. Monthly membership is ₦25,000. Your first week is free.",
  source: "brief" as const,
};

const asPlanned: ApprovedOutline = {
  kind: "carousel",
  points: [
    {
      id: "p1",
      role: "hook",
      title: "After every session",
      point: "Free towel service and a sauna after every session",
      source: "brief",
    },
    {
      id: "p2",
      role: "body",
      title: "Coach on the floor",
      point: COACH,
      source: "brief",
    },
    {
      id: "p3",
      role: "body",
      title: "Open every day",
      point: HOURS,
      source: "brief",
    },
    { id: "p4", ...CTA },
  ],
};

const coachDeleted: ApprovedOutline = {
  ...asPlanned,
  points: asPlanned.points.filter((p) => p.id !== "p2"),
};

const hoursCorrected: ApprovedOutline = {
  ...asPlanned,
  points: asPlanned.points.map((p) =>
    p.id === "p3"
      ? {
          ...p,
          point: "Ironclad Gym is open 5am to 11pm every day",
          source: "user",
        }
      : p,
  ),
};

const textsOf = (outline: ApprovedOutline) =>
  releasedFacts(outline, PLANNED, FACTS, FREE).map((n) => FACTS[n].text);

const plan = (frames: PlannedSequence["frames"]): PlannedSequence =>
  ({
    kind: "carousel",
    palette: {
      background: "#ffffff",
      surface: "#ffffff",
      text: "#111111",
      accent: "#cc3300",
    },
    logoPlacement: "top-left",
    logoFree: false,
    logoFreeQuote: null,
    backgroundTreatment: "photo",
    footerStyle: "text",
    aspectRatio: "4:5",
    frames,
  }) as unknown as PlannedSequence;

describe("outlineEdited", () => {
  it("is false for the outline as planned and true after a deletion or an owner's point", () => {
    expect(outlineEdited(asPlanned)).toBe(false);
    expect(outlineEdited(coachDeleted)).toBe(true);
    expect(outlineEdited(hoursCorrected)).toBe(true);
  });
});

describe("releasedFacts (O5 over H5)", () => {
  it("releases nothing when the owner approved the outline untouched", () => {
    expect(textsOf(asPlanned)).toEqual([]);
    expect(removedPoints(asPlanned, PLANNED, FACTS, FREE)).toEqual([]);
  });

  it("releases the fact a deleted point carried", () => {
    expect(textsOf(coachDeleted)).toEqual([COACH]);
  });

  it("releases the figure an owner corrected", () => {
    expect(textsOf(hoursCorrected)).toEqual(["5am to 10pm"]);
  });

  it("never releases a fact an approved point still states", () => {
    expect(textsOf(coachDeleted)).not.toContain(
      "Monthly membership is ₦25,000",
    );
    expect(textsOf(coachDeleted)).not.toContain("ironclad.ng/join");
  });

  it("does not ask a frame for a released fact", () => {
    const frames = [beatOf({ role: "hook" }), beatOf({ role: "cta" })];
    expect(
      factsUncovered(frames, FACTS, [COACH]).map((f) => f.text),
    ).not.toContain(COACH);
    const problems = validateSequence(plan(frames), {
      frameCount: 2,
      facts: FACTS,
      offering: null,
      hasImage: false,
      released: [COACH],
    });
    expect(problems.map((p) => p.detail)).not.toContain(
      `no frame states "${COACH}"`,
    );
  });
});

describe("withFactsDrawn with an approved outline", () => {
  /* The deleted coach point came back word for word as a footer line on
     the action frame: coverage drew every uncovered fact after the gate
     had cut it. */
  it("never draws a released fact onto the action frame's footer", () => {
    const frames = [
      beatOf({
        role: "hook",
        headline: "A sauna after every session",
        subheadline: "Free towel service and a sauna come with membership.",
      }),
      beatOf({
        role: "body",
        headline: "Open 5am to 10pm",
        subheadline: "Ironclad Gym is open every day on Allen Avenue, Ikeja.",
      }),
      beatOf({
        role: "cta",
        headline: "Your first week is free",
        subheadline: "Monthly membership is ₦25,000 after that.",
        cta: "Join at ironclad.ng/join",
      }),
    ];
    const filled = withFactsDrawn(
      plan(frames),
      FACTS,
      [[5], [1, 2, 3], [4, 7, 8]],
      [COACH],
    );
    expect(filled.drawn).not.toContain(COACH);
    expect(filled.plan.frames.flatMap(linesOf).join(" ")).not.toContain(
      "coach",
    );
    const without = withFactsDrawn(plan(frames), FACTS, [
      [5],
      [1, 2, 3],
      [4, 7, 8],
    ]);
    expect(without.drawn).toContain(COACH);
  });

  it("skips a home where the drawn line would make a removed point", () => {
    const frames = [
      beatOf({ role: "hook", headline: "A sauna after every session" }),
      beatOf({ role: "cta", headline: "Your first week is free" }),
    ];
    const filled = withFactsDrawn(
      plan(frames),
      [fact("condition", COACH)],
      [[], []],
      [],
      (line) => line === COACH,
    );
    expect(filled.drawn).toEqual([]);
  });
});

describe("faults for what the owner took out", () => {
  it("finds a removed point in a footer item and in the button", () => {
    const footer = beatOf({
      role: "cta",
      headline: "Your first week is free",
      footerLines: ["ironclad.ng/join · A coach is on the floor at all hours"],
    });
    expect(removedFaults([footer], [COACH], [CTA.point], FREE)).toHaveLength(1);
    const button = beatOf({
      role: "cta",
      headline: "Your first week is free",
      cta: "Train with a coach on the floor at all hours",
    });
    expect(removedFaults([button], [COACH], [CTA.point], FREE)).toHaveLength(1);
  });

  it("finds the brief's figure written back over the owner's correction", () => {
    const frames = [
      beatOf({
        role: "body",
        headline: "Open every day",
        subheadline: "Ironclad Gym runs 5am to 10pm, every day.",
      }),
    ];
    const faults = releasedFaults(
      frames,
      FACTS,
      ["5am to 10pm"],
      ["", "", "Ironclad Gym is open 5am to 11pm every day", ""],
    );
    expect(releasedFaults(frames, FACTS, ["5am to 10pm"])).toEqual([]);
    expect(faults).toHaveLength(1);
    expect(faults[0].weight).toBeGreaterThanOrEqual(3);
  });
});
