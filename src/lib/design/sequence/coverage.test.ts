import { describe, expect, it } from "vitest";
import { withFactsDrawn } from "./coverage";
import { CAFE_FACTS, cafePlan, fact, withFrame } from "./fixtures";
import { factsUncovered } from "./validate";

/* Fact indexes into CAFE_FACTS: 0 cold brew, 1 price, 2 date, 3 time,
   4 place, 5 contact. The cafe plan's owners, as its outline gave them. */
const OWNERS = [[0], [1], [2, 3], [4], [5]];

describe("withFactsDrawn (round-4 critic, MEDIUM 5: a known fact-uncovered shipped)", () => {
  it("writes a fact the copy left out on the frame meant to carry it, in the brief's words", () => {
    const plan = withFrame(cafePlan(), 2, { subheadline: "Come early" });
    expect(factsUncovered(plan.frames, CAFE_FACTS).map((f) => f.text)).toEqual([
      "8am to 2pm",
    ]);
    const { plan: filled, drawn } = withFactsDrawn(plan, CAFE_FACTS, OWNERS);
    expect(drawn).toEqual(["8am to 2pm"]);
    expect(filled.frames[2].footerLines).toEqual(["8am to 2pm"]);
    expect(factsUncovered(filled.frames, CAFE_FACTS)).toEqual([]);
    expect(filled.frames.filter((_, i) => i !== 2)).toEqual(
      plan.frames.filter((_, i) => i !== 2),
    );
  });

  it("goes to the action frame when the owner's footer is full, never to the hook", () => {
    const full = withFrame(
      withFrame(cafePlan(), 2, { subheadline: "Come early" }),
      2,
      { footerLines: ["Bring a friend", "Bring a bag", "Bring a flask"] },
    );
    const { plan } = withFactsDrawn(full, CAFE_FACTS, OWNERS);
    expect(plan.frames[4].footerLines).toContain("8am to 2pm");
    expect(plan.frames[0]).toEqual(full.frames[0]);
  });

  it("leaves a set that states everything as it is, and never writes the offering as small print", () => {
    const plan = cafePlan();
    expect(withFactsDrawn(plan, CAFE_FACTS, OWNERS)).toEqual({
      plan,
      drawn: [],
    });
    const unnamed = withFrame(plan, 0, { subheadline: "Slow and strong" });
    expect(
      withFactsDrawn(unnamed, [fact("product", "cold brew")], [[0]]).drawn,
    ).toEqual([]);
  });

  it("writes nothing it cannot draw", () => {
    const long = fact("offer", `${"a very long offer ".repeat(5)}today`);
    expect(withFactsDrawn(cafePlan(), [long], [[1]]).drawn).toEqual([]);
  });
});
