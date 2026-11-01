import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import {
  bareFrames,
  restatedSubheadlines,
  restatesHeadline,
  setFaults,
} from "./faults";
import {
  beatOf,
  CAFE_BRIEF,
  CAFE_FACTS,
  cafePlan,
  fact,
  withFrame,
} from "./fixtures";
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

/* O1 round-1 critic, HIGH 6: "15 seats" and "Six Saturdays" shipped as
   bare middle frames, and "Lumenfield." as a hook's whole subheadline. */
describe("shipGate never ships a bare frame it can fill from the brief", () => {
  const BRIEF =
    "WAEC maths crash course for SS3 students. Six Saturdays from 10 January, 9am to 12pm, at 4 Awolowo Avenue, Bodija. Every class works through past papers marked by WAEC examiners. ₦40,000 for the full course. 15 seats. Register at brightpath.ng.";
  const FACTS = [
    fact("product", "WAEC maths crash course"),
    fact("quantity", "Six Saturdays"),
    fact("date", "10 January"),
    fact("time", "9am to 12pm"),
    fact("place", "4 Awolowo Avenue, Bodija"),
    fact("price", "₦40,000 for the full course"),
    fact("quantity", "15 seats"),
    fact("contact", "brightpath.ng"),
  ];
  const plan = {
    ...cafePlan(),
    frames: [
      beatOf({
        role: "hook",
        headline: "Pass WAEC maths in six weeks",
        subheadline: "The WAEC maths crash course starts 10 January.",
      }),
      beatOf({ headline: "Marked by WAEC examiners" }),
      beatOf({ headline: "Six Saturdays" }),
      beatOf({
        role: "cta",
        headline: "Register at brightpath.ng",
        cta: "Register now",
        footerLines: ["₦40,000 for the full course", "15 seats"],
      }),
    ],
  };
  const gateRules: GateRules = {
    frameCount: 4,
    facts: FACTS,
    offering: "WAEC maths crash course",
    hasImage: false,
    brandName: "Bright Path",
    names: ["WAEC maths crash course"],
    ledger: factLedger([BRIEF, "Bright Path"], 3),
    claims: [
      "",
      "Every class works through past papers marked by WAEC examiners",
      "Six Saturdays",
      "",
    ],
    unsourced: [],
    briefText: BRIEF,
  };

  it("gives each bare middle frame a sentence under it", () => {
    const shipped = shipGate(plan, gateRules).plan;
    expect(bareFrames(shipped.frames)).toEqual([]);
    expect(shipped.frames[1].subheadline).toBe(
      "Every class works through past papers.",
    );
    expect(shipped.frames[2].subheadline).toMatch(/^From 10 January/);
  });

  it("writes the hook's missing name as the brief's sentence, not the bare name", () => {
    const deck =
      "Lumenfield runs 6 solar mini-grids in Benue market towns. Customers pay ₦150 per kWh against ₦420 for diesel. Contact Ngozi Ade, ngozi@lumenfield.ng.";
    const named = shipGate(
      {
        ...plan,
        kind: "presentation",
        frames: [
          beatOf({ role: "hook", headline: "Power at 40% below diesel" }),
          beatOf({
            headline: "₦150 per kWh",
            subheadline: "Customers pay against ₦420 for diesel.",
          }),
          beatOf({
            role: "cta",
            headline: "Join the round",
            cta: "Email Ngozi",
          }),
        ],
      },
      {
        ...gateRules,
        frameCount: 3,
        facts: [
          fact("price", "₦150 per kWh"),
          fact("contact", "ngozi@lumenfield.ng"),
        ],
        offering: null,
        brandName: "Lumenfield",
        names: ["Lumenfield"],
        ledger: factLedger([deck, "Lumenfield"], 3),
        claims: ["", "", ""],
        briefText: deck,
      },
    ).plan;
    expect(named.frames[0].subheadline).toBe(
      "Lumenfield runs 6 solar mini-grids in Benue market towns.",
    );
  });
});

describe("shipGate splits a bare two-part headline", () => {
  it("gives 'Steeped for 18 hours — then served over ice' a line under it", () => {
    const plan = withFrame(cafePlan(), 2, {
      headline: "Steeped for 18 hours — then served over ice",
      subheadline: "",
    });
    const shipped = shipGate(
      plan,
      rules({ claims: ["", "", "", "", ""] }),
    ).plan;
    expect(shipped.frames[2].headline).toBe("Steeped for 18 hours");
    expect(shipped.frames[2].subheadline).toBe("Served over ice.");
  });
});
