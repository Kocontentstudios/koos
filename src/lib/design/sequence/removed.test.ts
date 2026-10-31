import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import type { ArcPoint } from "./arc";
import type { ApprovedOutline } from "./contract";
import { setFaults } from "./faults";
import { CAFE_BRIEF, CAFE_FACTS, cafePlan, withFrame } from "./fixtures";
import { type GateRules, shipGate } from "./gate";
import { namesFree } from "./hook";
import {
  profileWithout,
  removedFaults,
  removedFromBrief,
  removedPoints,
} from "./removed";

const FREE = namesFree("Kiln Coffee", "cold brew");
const DELETED = "Every bottle is hand-labelled by our baristas";

const pool: ArcPoint[] = [
  {
    source: "brief",
    text: "Steeped for 18 hours, then served over ice",
    facts: [],
  },
  { source: "profile", text: "Beans from the Mambilla Plateau", facts: [] },
  { source: "profile", text: DELETED, facts: [] },
];

const outline: ApprovedOutline = {
  kind: "carousel",
  points: [
    {
      id: "p1",
      role: "hook",
      title: "Steeped",
      point: "Steeped for 18 hours, then served over ice",
      source: "brief",
    },
    {
      id: "p2",
      role: "body",
      title: "Mambilla",
      point: "Beans from the Mambilla Plateau",
      source: "profile",
    },
    {
      id: "p4",
      role: "cta",
      title: "Reserve",
      point: "WhatsApp 0803 555 0142 to reserve.",
      source: "brief",
    },
  ],
};

/* O1 round-1 critic, HIGH 5: the deleted "Every teacher is a working
   software engineer" shipped on F4 as "taught by a working software
   engineer". */
describe("removed points", () => {
  it("names every pool point no approved point makes", () => {
    expect(
      removedPoints(outline, pool, CAFE_FACTS, FREE).map((p) => p.text),
    ).toEqual([DELETED]);
  });

  it("takes a removed profile clause out of the profile the model reads, and does not name it", () => {
    const brand = profileWithout(
      {
        name: "Kiln Coffee",
        differentiators: `Beans from the Mambilla Plateau; ${DELETED.toLowerCase()}`,
      } as never,
      [DELETED],
      FREE,
    );
    expect(brand.differentiators).toBe("Beans from the Mambilla Plateau");
    expect(
      removedFromBrief(removedPoints(outline, pool, CAFE_FACTS, FREE)),
    ).toEqual([]);
  });

  it("finds a frame that still makes the removed point, in other words", () => {
    const frames = withFrame(cafePlan(), 2, {
      headline: "Beans from the Mambilla Plateau",
      subheadline: "Each bottle is labelled by hand by our baristas.",
    }).frames;
    const faults = removedFaults(
      frames,
      [DELETED],
      ["", "", "Beans from the Mambilla Plateau"],
      FREE,
    );
    expect(faults.map((f) => f.frame)).toEqual([2]);
    expect(faults[0].detail).toMatch(/took out/);
  });

  it("never ships it: the gate cuts the sentence and keeps the frame's own", () => {
    const plan = withFrame(cafePlan(), 2, {
      headline: "Beans from the Mambilla Plateau",
      subheadline:
        "Grown high in Taraba and roasted each week. Each bottle is labelled by hand by our baristas.",
    });
    const rules: GateRules = {
      frameCount: 5,
      facts: CAFE_FACTS,
      offering: "cold brew",
      hasImage: true,
      brandName: "Kiln Coffee",
      names: ["cold brew"],
      ledger: factLedger(
        [
          CAFE_BRIEF,
          "Kiln Coffee",
          "Grown high in Taraba and roasted each week",
          DELETED,
        ],
        3,
      ),
      claims: plan.frames.map((_, i) =>
        i === 2 ? "Beans from the Mambilla Plateau" : "",
      ),
      unsourced: [],
      removed: [DELETED],
    };
    const shipped = shipGate(plan, rules).plan;
    expect(shipped.frames[2].subheadline).toBe(
      "Grown high in Taraba and roasted each week.",
    );
    expect(
      setFaults(shipped, rules).filter((f) => /took out/.test(f.detail)),
    ).toEqual([]);
  });
});
