import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import type { FaultRules } from "./faults";
import { improves } from "./fixes";
import { CAFE_BRIEF, CAFE_FACTS, cafePlan, withFrame } from "./fixtures";
import { echoesHeadline } from "./hook";
import { factsUncovered } from "./validate";

const rules: FaultRules = {
  frameCount: 5,
  facts: CAFE_FACTS,
  offering: "cold brew",
  hasImage: true,
  brandName: "Kiln Coffee",
  names: ["cold brew"],
  ledger: factLedger([CAFE_BRIEF, "Kiln Coffee"], 2),
};

describe("improves: coverage is never traded", () => {
  it("refuses a rewrite that covers one fact by dropping another", () => {
    const missingTime = withFrame(cafePlan(), 2, { subheadline: "Come early" });
    expect(
      factsUncovered(missingTime.frames, CAFE_FACTS).map((f) => f.text),
    ).toEqual(["8am to 2pm"]);
    const missingDate = withFrame(cafePlan(), 2, {
      headline: "Doors open early",
      subheadline: "8am to 2pm",
    });
    expect(
      factsUncovered(missingDate.frames, CAFE_FACTS).map((f) => f.text),
    ).toContain("Saturday 15 November");
    expect(improves(missingTime, missingDate, rules)).toBe(false);
  });

  it("takes a rewrite that covers the missing fact and loses none", () => {
    const missingTime = withFrame(cafePlan(), 2, { subheadline: "Come early" });
    expect(improves(missingTime, cafePlan(), rules)).toBe(true);
  });
});

describe("echoesHeadline: the offering's own name", () => {
  it("does not read the offering named in full under a partial name as an echo", () => {
    expect(
      echoesHeadline(
        {
          headline: "Pastry masterclass, 15 seats",
          subheadline: "The weekend French pastry masterclass for home bakers.",
        },
        "Flour House",
        "weekend French pastry masterclass",
      ),
    ).toBe(false);
  });

  it("still reads the headline's own point said again as an echo", () => {
    expect(
      echoesHeadline(
        {
          headline: "Fifteen seats, six Saturdays",
          subheadline: "Only fifteen seats across six Saturdays.",
        },
        "Flour House",
        "pastry masterclass",
      ),
    ).toBe(true);
  });
});
