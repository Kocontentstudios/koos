import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import { blockingFaults, type FaultRules, setFaults } from "./faults";
import {
  beatOf,
  CAFE_BRIEF,
  CAFE_FACTS,
  cafePlan,
  withFrame,
} from "./fixtures";
import {
  clauseCuts,
  crossVersions,
  inventedWordCuts,
  lastResort,
} from "./last-resort";

describe("crossVersions", () => {
  it("pairs every writer's headline with every other writer's subheadline", () => {
    const beat = beatOf({
      headline: "Steeped 18 hours",
      subheadline: "No heat touches it, ever, so it stays smooth.",
    });
    const pairs = crossVersions(
      beat,
      [
        {
          change: {
            headline: "18 hours, cold water only",
            subheadline: "The long steep keeps the bitterness out.",
          },
          what: "another writer's version of it",
        },
      ],
      "carousel",
    ).map((v) => v.change);
    expect(pairs).toContainEqual({
      headline: "Steeped 18 hours",
      subheadline: "The long steep keeps the bitterness out.",
    });
    expect(pairs).toContainEqual({
      headline: "18 hours, cold water only",
      subheadline: "No heat touches it, ever, so it stays smooth.",
    });
    expect(pairs).not.toContainEqual({
      headline: "Steeped 18 hours",
      subheadline: "No heat touches it, ever, so it stays smooth.",
    });
  });
});

describe("inventedWordCuts", () => {
  it("takes an invented single word out of the line that says it", () => {
    const cuts = inventedWordCuts(
      beatOf({
        headline: "The only cold brew in Yaba",
        subheadline: "Steeped for 18 hours.",
      }),
      [
        {
          frame: 1,
          field: "frame",
          detail:
            'it states "only", which neither the brief nor the brand profile gives; leave it out',
          weight: 3,
        },
      ],
    );
    expect(cuts.map((c) => c.change.headline)).toEqual([
      "The cold brew in Yaba",
    ]);
  });

  it("takes an invented phrase out whole, and word by word", () => {
    const invented = (phrase: string) => ({
      frame: 6,
      field: "frame" as const,
      detail: `it states "${phrase}", which neither the brief nor the brand profile gives; leave it out`,
      weight: 3,
    });
    const cuts = inventedWordCuts(
      beatOf({
        headline: "One flat price for every bag",
        subheadline: "Farmers now have a place to store their crop.",
      }),
      [invented("one flat"), invented("flat price"), invented("now have")],
    ).map((c) => c.change);
    expect(cuts).toContainEqual({
      headline: "Price for every bag",
      subheadline: "Farmers now have a place to store their crop.",
    });
    expect(cuts).toContainEqual({
      headline: "One price for every bag",
      subheadline: "Farmers now have a place to store their crop.",
    });
    expect(cuts).toContainEqual({
      headline: "One flat price for every bag",
      subheadline: "Farmers have a place to store their crop.",
    });
  });

  it("never cuts a figure word by word", () => {
    const cuts = inventedWordCuts(
      beatOf({ subheadline: "Back clean two days later." }),
      [
        {
          frame: 1,
          field: "frame",
          detail:
            'it states "2 days", which neither the brief nor the brand profile gives; leave it out',
          weight: 3,
        },
      ],
    );
    expect(cuts).toEqual([]);
  });
});

describe("lastResort: a blocking fault no single version clears", () => {
  const rules: FaultRules = {
    frameCount: 5,
    facts: CAFE_FACTS,
    offering: "cold brew",
    hasImage: true,
    brandName: "Kiln Coffee",
    names: ["cold brew"],
    ledger: factLedger([CAFE_BRIEF, "Kiln Coffee"], 1),
  };

  it("clears an invented word on the hook without refusing the set", () => {
    const plan = withFrame(cafePlan(), 0, {
      headline: "The only cold brew steeped 18 hours",
    });
    const before = blockingFaults(setFaults(plan, rules)).filter((f) =>
      /"only"/.test(f.detail),
    );
    expect(before.length).toBeGreaterThan(0);
    const result = lastResort(plan, rules, ["", "", "", "", ""]);
    expect(result.blocking.filter((f) => /"only"/.test(f.detail))).toEqual([]);
    expect(result.plan.frames[0].headline).not.toMatch(/\bonly\b/i);
  });
});

describe("clauseCuts", () => {
  it("keeps a writer's first clause when the rest adds what no source gives", () => {
    const cuts = clauseCuts([
      {
        change: {
          headline: "Grown on the Mambilla Plateau",
          subheadline:
            "Every bean comes from Nigeria's highest plateau, where cooler air slows the cherry and deepens the cup.",
        },
        what: "another writer's version of it",
      },
    ]);
    expect(cuts.map((c) => c.change.subheadline)).toEqual([
      "Every bean comes from Nigeria's highest plateau.",
    ]);
  });

  it("never cuts to a stub", () => {
    expect(
      clauseCuts([
        {
          change: { subheadline: "Fresh, and made by hand every morning." },
          what: "x",
        },
      ]),
    ).toEqual([]);
  });
});

describe("lastResort: a fault a reader notices but nothing blocks on", () => {
  it("swaps a headline past its word budget for a writer's shorter one", () => {
    const rules: FaultRules = {
      frameCount: 5,
      facts: CAFE_FACTS,
      offering: "cold brew",
      hasImage: true,
      brandName: "Kiln Coffee",
      names: ["cold brew"],
      ledger: factLedger([CAFE_BRIEF, "Kiln Coffee"], 1),
    };
    const long = "Pour one at our Yaba bar and sit in with a cold glass";
    const plan = withFrame(cafePlan(), 3, { headline: long });
    const overBudget = (p: typeof plan) =>
      setFaults(p, rules).filter(
        (f) => f.frame === 3 && /words, over the/.test(f.detail),
      );
    expect(overBudget(plan).length).toBeGreaterThan(0);
    const alternates = plan.frames.map((_, i) =>
      i === 3 ? [{ headline: "Pour one at our Yaba bar" }] : [],
    );
    const result = lastResort(
      plan,
      rules,
      ["", "", "", "", ""],
      undefined,
      alternates,
    );
    expect(result.plan.frames[3].headline).not.toBe(long);
    expect(overBudget(result.plan)).toEqual([]);
  });
});
