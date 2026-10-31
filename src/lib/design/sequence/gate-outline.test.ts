import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import {
  bareFrames,
  restatedSubheadlines,
  restatesHeadline,
  setFaults,
} from "./faults";
import { CAFE_BRIEF, CAFE_FACTS, cafePlan, withFrame } from "./fixtures";
import { claimHalves, type GateRules, shipGate } from "./gate";

const STEEPED = "It is steeped for 18 hours and served over ice.";
const OWNER = "Each bottle is 350ml and keeps for 5 days in the fridge";

const rules = (over: Partial<GateRules> = {}): GateRules => ({
  frameCount: 5,
  facts: CAFE_FACTS,
  offering: "cold brew",
  hasImage: true,
  brandName: "Kiln Coffee",
  names: ["cold brew"],
  ledger: factLedger([`${CAFE_BRIEF} ${STEEPED}`, "Kiln Coffee", OWNER], 3),
  claims: [
    "Slow-steeped cold brew for a slower Saturday",
    "Steeped for 18 hours, then served over ice",
    OWNER,
    "Pour one at our Yaba bar",
    "",
  ],
  unsourced: [],
  ...over,
});

describe("claimHalves", () => {
  it.each([
    [
      "Steeped for 18 hours, then served over ice",
      ["Steeped for 18 hours", "Served over ice."],
    ],
    [
      "No sugar added; we put syrup on the side",
      ["No sugar added", "We put syrup on the side."],
    ],
  ])("splits %s into a headline and a sentence", (claim, halves) => {
    expect(claimHalves(claim)).toEqual(halves);
  });

  it("refuses a join where a half says nothing of its own", () => {
    expect(claimHalves("Brands and buyers")).toBeNull();
    expect(claimHalves("Beans from one farm")).toBeNull();
    expect(
      claimHalves(
        "Each teen shapes and bakes their own loaf and takes it home",
      ),
    ).toEqual(["Each teen shapes and bakes their own loaf", "Takes it home."]);
    expect(claimHalves(OWNER)).toBeNull();
  });
});

describe("shipGate: no headline-only middle frame, no restated subheadline", () => {
  it("gives a bare middle frame its claim in two lines when the claim is its headline", () => {
    const plan = withFrame(cafePlan(), 1, {
      headline: "Steeped for 18 hours, then served over ice",
      subheadline: "",
    });
    expect(bareFrames(plan.frames).map((f) => f.frame)).toContain(1);
    const { plan: gated, applied } = shipGate(plan, rules());
    expect(gated.frames[1].headline).toBe("Steeped for 18 hours");
    expect(gated.frames[1].subheadline).toBe("Served over ice.");
    expect(applied.join(" ")).toMatch(/two lines/);
    expect(bareFrames(gated.frames).map((f) => f.frame)).not.toContain(1);
  });

  it("takes out a subheadline that says its headline again", () => {
    const plan = withFrame(cafePlan(), 1, {
      headline: "Steeped for 18 hours",
      subheadline: "Every batch is steeped for 18 hours.",
    });
    expect(restatesHeadline(plan.frames[1])).toBe(true);
    expect(restatedSubheadlines(plan.frames).map((f) => f.frame)).toEqual([1]);
    const { plan: gated } = shipGate(plan, rules());
    expect(restatesHeadline(gated.frames[1])).toBe(false);
    expect(gated.frames[1].subheadline.trim()).not.toBe("");
  });

  it("weighs a restated subheadline as blocking, so a fix call is asked for it", () => {
    const plan = withFrame(cafePlan(), 1, {
      headline: "Steeped for 18 hours",
      subheadline: "Every batch is steeped for 18 hours.",
    });
    const fault = setFaults(plan, rules()).find(
      (f) => f.frame === 1 && /says its headline again/.test(f.detail),
    );
    expect(fault?.weight).toBeGreaterThanOrEqual(3);
  });
});

describe("shipGate: the owner's point stays the owner's (O5)", () => {
  const owned = ["", "", OWNER, "", ""];

  it("finds a frame whose copy changed the owner's claim", () => {
    const plan = withFrame(cafePlan(), 2, {
      headline: "Made fresh for the weekend",
      subheadline: "Grab a bottle while you can.",
    });
    const faults = setFaults(plan, rules({ owned })).filter((f) =>
      f.detail.includes("owner's point"),
    );
    expect(faults.map((f) => f.frame)).toEqual([2]);
  });

  it("gives the owner's point back when the copy dropped it", () => {
    const plan = withFrame(cafePlan(), 2, {
      headline: "Saturday 15 November",
      subheadline: "A good day to sit in.",
    });
    const { plan: gated } = shipGate(plan, rules({ owned }));
    const copy = `${gated.frames[2].headline} ${gated.frames[2].subheadline}`;
    expect(copy).toContain("350ml");
    expect(copy).toContain("5 days");
  });

  it("keeps copy that only shortens the owner's point", () => {
    const plan = withFrame(cafePlan(), 2, {
      headline: "350ml, good for 5 days",
      subheadline: "Each bottle keeps in the fridge for 5 days.",
    });
    const faults = setFaults(plan, rules({ owned })).filter((f) =>
      f.detail.includes("owner's point"),
    );
    expect(faults).toEqual([]);
  });
});
