import { describe, expect, it } from "vitest";
import type { FrameBeat } from "./contract";
import { beatOf, CAFE_FACTS, cafePlan, fact } from "./fixtures";
import {
  briefPoints,
  factOnlyFrames,
  misplacedPrices,
  priceAmounts,
  pricesWithoutScope,
  profileClauses,
  profilePoints,
} from "./points";

const priceFrame = (over: Partial<FrameBeat> = {}) =>
  beatOf({ headline: "₦2,500 a Bottle", subheadline: "", ...over });

describe("factOnlyFrames", () => {
  it("names a middle frame that is only the price", () => {
    const frames = [cafePlan().frames[0], priceFrame(), cafePlan().frames[4]];
    expect(factOnlyFrames(frames, CAFE_FACTS)).toEqual([
      {
        frame: 1,
        detail: expect.stringContaining(
          'its headline only gives "₦2,500 a bottle", a bare detail',
        ),
      },
    ]);
  });

  it("names an offer or a count standing alone", () => {
    const facts = [
      fact("offer", "Free for your first 3 months"),
      fact("quantity", "12 places"),
    ];
    const frames = [
      beatOf({ role: "hook", headline: "Still chasing payment?" }),
      beatOf({ headline: "Free for your first 3 months" }),
      beatOf({ headline: "Only 12 places" }),
      beatOf({ role: "cta", headline: "Sign up", cta: "Sign up free" }),
    ];
    expect(factOnlyFrames(frames, facts).map((f) => f.frame)).toEqual([1, 2]);
  });

  it("passes a fact with a line on what it buys, or framed as value", () => {
    expect(
      factOnlyFrames(
        [priceFrame({ subheadline: "Less than your weekly coffee run" })],
        CAFE_FACTS,
      ),
    ).toEqual([]);
    expect(
      factOnlyFrames(
        [priceFrame({ headline: "₦2,500 a bottle, steeped for a whole day" })],
        CAFE_FACTS,
      ),
    ).toEqual([]);
  });

  it("leaves the hook and the action frame to their own checks", () => {
    expect(
      factOnlyFrames(
        [priceFrame({ role: "hook" }), priceFrame({ role: "cta", cta: "Go" })],
        CAFE_FACTS,
      ),
    ).toEqual([]);
  });

  it('names a bare date or venue frame ("Launches on 3 March")', () => {
    const facts = [fact("date", "3 March"), ...CAFE_FACTS];
    const frames = [
      beatOf({ role: "hook", headline: "Still chasing payment?" }),
      beatOf({ headline: "Launches on 3 March" }),
      beatOf({ headline: "Saturday 15 November" }),
      beatOf({ headline: "Pour one at our Yaba bar" }),
      beatOf({ role: "cta", headline: "Sign up", cta: "Sign up" }),
    ];
    expect(factOnlyFrames(frames, facts).map((f) => f.frame)).toEqual([
      1, 2, 3,
    ]);
    const said = frames.map((beat, i) =>
      i === 0 || i === 4
        ? beat
        : { ...beat, subheadline: "The first invoice takes a minute" },
    );
    expect(factOnlyFrames(said, facts)).toEqual([]);
  });
});

describe("profilePoints", () => {
  const brand = {
    overview: "Coffee bar in Yaba, Lagos",
    offer: "Specialty coffee and cold brew",
    values: "Patience over shortcuts",
    differentiators: "Beans from the Mambilla Plateau, roasted each week",
    targetAudience: "Students in Yaba",
    primaryGoal: "Make the bar a weekend habit",
  };

  it("lists the profile's statements clause by clause, what sets the brand apart first, never the goal or the audience", () => {
    expect(profilePoints(brand, "Launch our cold brew.")).toEqual([
      { field: "differentiators", text: "Beans from the Mambilla Plateau" },
      { field: "differentiators", text: "Roasted each week" },
      { field: "offer", text: "Specialty coffee and cold brew" },
      { field: "values", text: "Patience over shortcuts" },
      { field: "overview", text: "Coffee bar in Yaba, Lagos" },
    ]);
  });

  it("leaves out a field the brief already says, and one another field says", () => {
    const points = profilePoints(
      { ...brand, overview: "Specialty coffee, cold brew too" },
      "Patience over shortcuts, every glass.",
    );
    expect(points.map((p) => p.field)).toEqual([
      "differentiators",
      "differentiators",
      "offer",
    ]);
  });

  it("reads a clause too short to stand with the one before it", () => {
    expect(
      profileClauses(
        "Full-grain leather, hand-stitched soles, free resole in year one",
      ),
    ).toEqual([
      "Full-grain leather",
      "Hand-stitched soles",
      "Free resole in year one",
    ]);
    expect(profileClauses("Coffee bar in Yaba, Lagos")).toEqual([
      "Coffee bar in Yaba, Lagos",
    ]);
    expect(
      profileClauses(
        "Brings designers, brands and buyers into one programme. A week of talks, exhibitions and a market",
      ),
    ).toEqual([
      "Brings designers, brands and buyers into one programme",
      "A week of talks, exhibitions and a market",
    ]);
    expect(
      profileClauses(
        "Bike servicing. Gears tuned and brakes bled in one visit",
      ),
    ).toEqual(["Bike servicing", "Gears tuned and brakes bled in one visit"]);
    expect(
      profileClauses(
        "Kano hibiscus; dates, no refined sugar. Made at ledgerly.app daily.",
      ),
    ).toEqual([
      "Kano hibiscus, dates",
      "No refined sugar",
      "Made at ledgerly.app daily",
    ]);
  });
});

describe("misplacedPrices", () => {
  it("names a carousel price the copy put before the action frame", () => {
    expect(misplacedPrices(cafePlan().frames, CAFE_FACTS, "carousel")).toEqual([
      {
        frame: 1,
        detail: expect.stringContaining(
          'it gives the price "₦2,500 a bottle", which belongs on frame 5',
        ),
      },
    ]);
  });

  it("finds the amount in any words around it", () => {
    const pair = [fact("price", "₦32,000 a pair")];
    const said = (headline: string) =>
      misplacedPrices(
        [
          beatOf({ role: "hook", headline: "Shoes that outlast you" }),
          beatOf({ headline }),
          beatOf({ role: "cta", headline: "Order", cta: "Order" }),
        ],
        pair,
        "carousel",
      ).map((f) => f.frame);
    for (const headline of [
      "₦32,000 a pair",
      "Priced at ₦32,000",
      "Just ₦32,000",
      "₦32,000 for a pair",
      "₦32,000 this December",
      "Only N32,000",
      "32,000 naira, resoled free",
      "₦32k a pair",
    ]) {
      expect(said(headline), headline).toEqual([1]);
    }
    expect(said("Full-grain leather, 2 colours")).toEqual([]);
    expect([...priceAmounts(fact("price", "₦8,000 for a 10kg bag"))]).toEqual([
      "8000",
    ]);
  });

  it("leaves a price on the action frame, and a deck's prices, alone", () => {
    const frames = cafePlan().frames.map((beat, i) => {
      if (i === 1) return { ...beat, headline: "Chilled and ready to carry" };
      return i === 4 ? { ...beat, footerLines: ["₦2,500 a bottle"] } : beat;
    });
    expect(misplacedPrices(frames, CAFE_FACTS, "carousel")).toEqual([]);
    expect(
      misplacedPrices(cafePlan().frames, CAFE_FACTS, "presentation"),
    ).toEqual([]);
  });
});

describe("briefPoints", () => {
  it("lists what the brief says beyond its facts, clause by clause", () => {
    const brief =
      "Launch our cold brew at our Yaba bar. It is steeped for 18 hours and served over ice. ₦2,500 a bottle. WhatsApp 0803 555 0142 to reserve a bottle.";
    expect(briefPoints(brief, CAFE_FACTS)).toEqual([
      "It is steeped for 18 hours and served over ice",
    ]);
  });

  it("is empty for a brief that is only facts", () => {
    expect(
      briefPoints("₦2,500 a bottle. Saturday 15 November.", CAFE_FACTS),
    ).toEqual([]);
  });
});

describe("pricesWithoutScope: a price keeps what the brief says it is for", () => {
  const price = fact("price", "₦12,000");
  const brief = "Fixit Hub tune-ups cost ₦12,000. We fix punctures and brakes.";
  const free = new Set(["fixit", "hub"]);

  it("names a frame that widens a tune-up's price to every service", () => {
    const frames = [
      beatOf({ role: "cta", headline: "Your service costs ₦12,000" }),
    ];
    expect(pricesWithoutScope(frames, [price], brief, free)).toEqual([
      {
        frame: 0,
        detail: expect.stringContaining(
          '"₦12,000" without what the brief says',
        ),
      },
    ]);
  });

  it("reads the whole frame, so a bare footer under its item keeps its scope", () => {
    const frames = [
      beatOf({
        role: "cta",
        headline: "Book a tune-up today",
        footerLines: ["₦12,000"],
      }),
    ];
    expect(pricesWithoutScope(frames, [price], brief, free)).toEqual([]);
  });
});
