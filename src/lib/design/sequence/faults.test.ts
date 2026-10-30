import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import {
  blockingFaults,
  COVERAGE,
  type FaultRules,
  faultScore,
  flaggedFaults,
  headlinePrices,
  hookScore,
  MAJOR,
  pointRepeats,
  selfReferences,
  setFaults,
  subheadlineGrammar,
  titleFaults,
} from "./faults";
import { CAFE_BRIEF, CAFE_FACTS, cafePlan, withFrame } from "./fixtures";

const rules: FaultRules = {
  frameCount: 5,
  facts: CAFE_FACTS,
  offering: "cold brew",
  hasImage: true,
  brandName: "Kiln Coffee",
  names: ["cold brew"],
  ledger: factLedger([CAFE_BRIEF, "Kiln Coffee"], 1),
};

describe("subheadlineGrammar", () => {
  it("finds a subheadline split off its subject", () => {
    expect(
      subheadlineGrammar(
        "is fully allocated to expanding cold-chain coverage.",
      ),
    ).toMatch(/starts mid-sentence/);
    expect(
      subheadlineGrammar("Is fully allocated to expanding coverage."),
    ).toMatch(/has no subject/);
  });

  it("passes a whole sentence and an empty field", () => {
    expect(
      subheadlineGrammar("The raise buys ten vans for the cold chain."),
    ).toBeNull();
    expect(subheadlineGrammar("")).toBeNull();
  });
});

describe("titleFaults", () => {
  it("finds two frames under one title in any casing", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 1, { title: "Cold-Chain Advantage" }),
      3,
      { title: "Cold-chain advantage" },
    );
    expect(titleFaults(plan.frames, [])).toContainEqual(
      expect.objectContaining({
        frame: 3,
        field: "title",
        weight: MAJOR,
        detail: expect.stringMatching(/an earlier frame's title/),
      }),
    );
  });

  it("finds a title cut from the brief and a placeholder", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 1, { title: "Steeped for eighteen" }),
      4,
      { title: "How to act" },
    );
    const faults = titleFaults(plan.frames, [
      "Steeped for eighteen hours, served over ice",
    ]);
    expect(faults.find((f) => f.frame === 1)?.detail).toMatch(/cut off/);
    expect(faults.find((f) => f.frame === 4)?.detail).toMatch(/placeholder/);
  });
});

describe("flaggedFaults", () => {
  it("holds a repeat until the later frame is rewritten", () => {
    const plan = cafePlan();
    const flag = {
      kind: "repeat" as const,
      frame: 3,
      sameAs: 1,
      headline: plan.frames[3].headline,
    };
    expect(flaggedFaults(plan.frames, [flag])).toEqual([
      expect.objectContaining({
        frame: 3,
        field: "headline",
        weight: MAJOR,
        detail: expect.stringMatching(/makes frame 2's point/),
      }),
    ]);
    const rewritten = withFrame(plan, 3, { headline: "Another point" });
    expect(flaggedFaults(rewritten.frames, [flag])).toEqual([]);
  });

  it("holds an unsourced statement until its words are gone", () => {
    const plan = withFrame(cafePlan(), 2, {
      subheadline: "Walk in any time. No appointment needed.",
    });
    const flag = {
      kind: "unsourced" as const,
      frame: 2,
      text: "No appointment needed",
    };
    expect(flaggedFaults(plan.frames, [flag])).toHaveLength(1);
    const cut = withFrame(plan, 2, { subheadline: "Walk in any time." });
    expect(flaggedFaults(cut.frames, [flag])).toEqual([]);
  });
});

describe("selfReferences", () => {
  it("finds copy about the set itself", () => {
    const plan = withFrame(cafePlan(), 0, {
      subheadline: "This investor deck covers the round.",
    });
    expect(selfReferences(plan.frames)).toEqual([
      expect.objectContaining({ frame: 0, field: "subheadline" }),
    ]);
  });

  it("leaves copy about the offering alone", () => {
    expect(selfReferences(cafePlan().frames)).toEqual([]);
  });
});

describe("pointRepeats", () => {
  it("finds a headline that makes an earlier frame's point under another title", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 1, {
        title: "Who owns it",
        headline: "Quality held by us, not a third party",
        subheadline: "Every van is ours, cold chain and all",
      }),
      3,
      {
        title: "The vans",
        headline: "We own every cold-chain van",
        subheadline: "",
      },
    );
    expect(pointRepeats(plan.frames, CAFE_FACTS, new Set())).toEqual([
      expect.objectContaining({ frame: 3, field: "headline" }),
    ]);
  });

  it("passes frames that make different points", () => {
    expect(pointRepeats(cafePlan().frames, CAFE_FACTS, new Set())).toEqual([]);
  });
});

describe("headlinePrices", () => {
  it("finds a carousel's price in a headline before the action frame", () => {
    const plan = withFrame(cafePlan(), 0, {
      headline: "₦2,500 for slow cold brew",
    });
    const found = headlinePrices(plan.frames, CAFE_FACTS, "carousel");
    expect(found.map((f) => f.frame)).toEqual([0, 1]);
    expect(found[0].weight).toBe(MAJOR);
  });

  it("leaves a deck's price where it is", () => {
    expect(
      headlinePrices(cafePlan().frames, CAFE_FACTS, "presentation"),
    ).toEqual([]);
  });
});

describe("setFaults", () => {
  it("weighs a missing fact as coverage, owned by the frame meant to state it", () => {
    const plan = withFrame(cafePlan(), 4, { footerLines: [] });
    const faults = setFaults(plan, {
      ...rules,
      owners: [[0], [1], [2, 3], [4], [5]],
    });
    expect(faults).toContainEqual(
      expect.objectContaining({ frame: 4, weight: COVERAGE }),
    );
  });

  it("blocks a fragment subheadline, a duplicate title and an announcing hook", () => {
    let plan = withFrame(cafePlan(), 0, { headline: "Cold brew is here" });
    plan = withFrame(plan, 3, {
      title: "The launch",
      subheadline: "is poured over ice every morning.",
    });
    const blocking = blockingFaults(setFaults(plan, rules));
    const fields = blocking.map((f) => `${f.frame}:${f.field}`);
    expect(fields).toEqual(
      expect.arrayContaining(["0:headline", "3:subheadline", "3:title"]),
    );
  });

  it("scores a clean set below the same set with a repeat", () => {
    const clean = faultScore(setFaults(cafePlan(), rules));
    const repeated = faultScore(
      setFaults(
        withFrame(cafePlan(), 3, { headline: "Your Saturday, slowed down" }),
        rules,
      ),
    );
    expect(repeated).toBeGreaterThan(clean);
  });
});

describe("hookScore", () => {
  it("prefers an opening that names the offering and gives a reason over an announcement", () => {
    const plan = cafePlan();
    const flat = hookScore(
      { ...plan.frames[0], headline: "Cold brew is here", subheadline: "" },
      plan,
      rules,
    );
    const strong = hookScore(plan.frames[0], plan, rules);
    expect(strong).toBeLessThan(flat);
  });
});
