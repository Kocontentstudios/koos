import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import type { FaultRules } from "./faults";
import { CAFE_BRIEF, CAFE_FACTS, cafePlan, withFrame } from "./fixtures";
import { type Draft, settlePick } from "./pick";

const rules: FaultRules = {
  frameCount: 5,
  facts: CAFE_FACTS,
  offering: "cold brew",
  hasImage: true,
  brandName: "Kiln Coffee",
  names: ["cold brew"],
  ledger: factLedger([CAFE_BRIEF, "Kiln Coffee"], 1),
};

const draftOf = (plan = cafePlan()): Draft => ({
  plan,
  hooks: [
    {
      headline: plan.frames[0].headline,
      subheadline: plan.frames[0].subheadline,
    },
    {
      headline: "Cold brew, slow-steeped",
      subheadline: "Our cold brew is poured over ice at the bar.",
    },
  ],
});

describe("settlePick", () => {
  it("keeps the editor's draft and opening when code finds them no worse", () => {
    const a = draftOf();
    const b = draftOf(
      withFrame(cafePlan(), 1, { subheadline: "Steeped long, served cold." }),
    );
    const settled = settlePick([a, b], { set: 1, hook: 2 }, rules);
    expect(settled.draft).toBe(1);
    expect(settled.hook).toBe(2);
    expect(settled.plan.frames[0].headline).toBe(cafePlan().frames[0].headline);
    expect(settled.plan.frames[1].subheadline).toBe(
      "Steeped long, served cold.",
    );
    expect(settled.overruled).toBeNull();
  });

  it("refuses a draft with more blocking faults after frame 1 than the slack allows", () => {
    const bare = cafePlan();
    const broken = {
      ...bare,
      frames: bare.frames.map((beat, i) =>
        i === 1 || i === 2 ? { ...beat, subheadline: "" } : beat,
      ),
    };
    const settled = settlePick(
      [draftOf(), draftOf(broken)],
      { set: 1, hook: 0 },
      rules,
    );
    expect(settled.draft).toBe(0);
    expect(settled.overruled).toMatch(/blocking fault/);
  });

  it("refuses an opening with more faults on frame 1 than the best", () => {
    const a = draftOf();
    a.hooks = [
      ...a.hooks,
      { headline: "Your Saturday, slowed down", subheadline: "Slow mornings." },
    ];
    const settled = settlePick([a], { set: 0, hook: 2 }, rules);
    expect(settled.hook).not.toBe(2);
    expect(settled.overruled).toMatch(/opening 3/);
  });

  it("with no pick, keeps the first draft's fewest-fault opening", () => {
    const settled = settlePick([draftOf()], null, rules);
    expect(settled.draft).toBe(0);
    expect(settled.overruled).toBeNull();
  });
});
