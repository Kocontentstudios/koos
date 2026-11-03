import { describe, expect, it } from "vitest";
import { withFactsDrawn } from "./coverage";
import { CAFE_FACTS, cafePlan, fact, withFrame } from "./fixtures";
import { factsUncovered } from "./validate";

/* Fact indexes into CAFE_FACTS: 0 cold brew, 1 price, 2 date, 3 time,
   4 place, 5 contact. The cafe plan's owners, as its outline gave them. */
const OWNERS = [[0], [1], [2, 3], [4], [5]];

describe("withFactsDrawn: no known fact-uncovered ships", () => {
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

  it("joins the fact onto a line when every footer it may go on is full", () => {
    const full = ["Bring a friend", "Bring a bag", "Bring a flask"];
    let plan = withFrame(cafePlan(), 2, { subheadline: "Come early" });
    for (const i of [1, 2, 3, 4]) {
      plan = withFrame(plan, i, { footerLines: [...full] });
    }
    plan = withFrame(plan, 4, {
      footerLines: ["₦2,500 a bottle", "Saturday 15 November", "Our Yaba bar"],
    });
    const { plan: filled, drawn } = withFactsDrawn(plan, CAFE_FACTS, OWNERS);
    expect(drawn).toContain("8am to 2pm");
    expect(
      factsUncovered(filled.frames, CAFE_FACTS).map((f) => f.text),
    ).not.toContain("8am to 2pm");
    expect(filled.frames[0]).toEqual(plan.frames[0]);
    expect(
      filled.frames
        .flatMap((f) => f.footerLines)
        .some((l) => l.includes(" · 8am to 2pm")),
    ).toBe(true);
  });

  it("leaves a set that states everything as it is, and never writes the offering as small print", () => {
    const plan = cafePlan();
    expect(withFactsDrawn(plan, CAFE_FACTS, OWNERS)).toEqual({
      plan,
      drawn: [],
      restated: [],
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

describe("withFactsDrawn: a count the copy already gives", () => {
  const estates = fact("quantity", "31 estates use them");
  const facts = [...CAFE_FACTS, estates];
  const owners = [...OWNERS.slice(0, 4), [4, 6], [5]];

  it("still draws a fact the copy gives only in other words: coverage is a hard gate", () => {
    const plan = withFrame(cafePlan(), 3, {
      subheadline: "31 estates already pour it",
    });
    const { plan: filled, drawn } = withFactsDrawn(plan, facts, owners);
    expect(drawn).toEqual(["31 estates use them"]);
    expect(factsUncovered(filled.frames, facts)).toEqual([]);
    expect(filled.frames[3].footerLines).not.toContain("31 estates use them");
  });

  it("draws a turnaround a headline gives in other words, even beside a price with the same figure", () => {
    const turnaround = fact("condition", "done in 2 days");
    const plan = withFrame(
      withFrame(cafePlan(), 3, { headline: "Back with you in 2 days" }),
      4,
      {
        footerLines: ["₦2,500 a bottle", "WhatsApp 0803 555 0142", "Yaba"],
      },
    );
    const all = [...CAFE_FACTS, turnaround];
    const { plan: filled } = withFactsDrawn(plan, all, [...OWNERS, [3]]);
    expect(factsUncovered(filled.frames, all)).toEqual([]);
    expect(filled.frames[0]).toEqual(plan.frames[0]);
  });

  it("still writes a count whose words read on their own", () => {
    const rooms = fact("quantity", "14 cold rooms");
    const plan = withFrame(cafePlan(), 3, {
      subheadline: "14 rooms and counting",
    });
    const { drawn } = withFactsDrawn(plan, [...CAFE_FACTS, rooms], owners);
    expect(drawn).toEqual(["14 cold rooms"]);
  });
});

describe("withFactsDrawn: a count the copy already gives after its verb", () => {
  it("draws no footer for a count a headline states", () => {
    const facts = [
      ...CAFE_FACTS,
      fact("quantity", "3x in 2025"),
      fact("quantity", "5,000 more kits"),
    ];
    const plan = withFrame(
      withFrame(cafePlan(), 1, { headline: "Revenue grew 3x in 2025" }),
      3,
      { headline: "The round buys 5,000 more kits" },
    );
    const { drawn, plan: filled } = withFactsDrawn(plan, facts, [
      ...OWNERS,
      [],
      [],
    ]);
    expect(drawn).not.toContain("3x in 2025");
    expect(drawn).not.toContain("5,000 more kits");
    expect(filled.frames.flatMap((f) => f.footerLines)).not.toContain(
      "3x in 2025",
    );
  });
});

describe("withFactsDrawn: a footer item giving part of a fact", () => {
  it("puts the fact's own words in its place rather than beside it", () => {
    const facts = [...CAFE_FACTS, fact("quantity", "One 60-minute session")];
    const plan = withFrame(cafePlan(), 4, {
      footerLines: [
        "60-minute session · ₦2,500 a bottle",
        "WhatsApp 0803 555 0142",
      ],
    });
    expect(factsUncovered(plan.frames, facts).map((f) => f.text)).toEqual([
      "One 60-minute session",
    ]);
    const { plan: filled, drawn } = withFactsDrawn(plan, facts, [
      ...OWNERS,
      [],
    ]);
    expect(drawn).toEqual(["One 60-minute session"]);
    expect(filled.frames[4].footerLines).toEqual([
      "One 60-minute session · ₦2,500 a bottle",
      "WhatsApp 0803 555 0142",
    ]);
    expect(factsUncovered(filled.frames, facts)).toEqual([]);
  });
});

describe("withFactsDrawn: a figure the frame already gives", () => {
  it("never draws a count whose figures the frame's own copy states", () => {
    const facts = [...CAFE_FACTS, fact("quantity", "40 kilos a week")];
    const plan = withFrame(cafePlan(), 4, {
      headline: "We roast 40 kilos for you",
    });
    const { plan: filled } = withFactsDrawn(plan, facts, [...OWNERS, [4]]);
    expect(filled.frames[4].footerLines).not.toContain("40 kilos a week");
  });
});

/* The deck's action frame carried three code-drawn figures from earlier
   slides as its footer: a figure that is a reason belongs mid-set. */
describe("withFactsDrawn: where a reason's figure goes", () => {
  it("draws a count with no planned frame onto a middle frame before the action", () => {
    const facts = [
      ...CAFE_FACTS,
      fact("quantity", "3,400 tonnes sold in 2025"),
    ];
    const { plan: filled, drawn } = withFactsDrawn(cafePlan(), facts, [
      ...OWNERS,
      [],
    ]);
    expect(drawn).toEqual(["3,400 tonnes sold in 2025"]);
    const at = filled.frames.findIndex((b) =>
      b.footerLines.includes("3,400 tonnes sold in 2025"),
    );
    expect(filled.frames[at].role).toBe("body");
  });
});
