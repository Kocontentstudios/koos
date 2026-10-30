import { describe, expect, it } from "vitest";
import type { FrameBeat } from "./contract";
import { beatOf, CAFE_FACTS, cafePlan, fact } from "./fixtures";
import { factOnlyFrames, misplacedPrices, profilePoints } from "./points";

const priceFrame = (over: Partial<FrameBeat> = {}) =>
  beatOf({ headline: "₦2,500 a Bottle", subheadline: "", ...over });

describe("factOnlyFrames", () => {
  it("names a middle frame that is only the price (round-2 critic, every five-frame carousel)", () => {
    const frames = [cafePlan().frames[0], priceFrame(), cafePlan().frames[4]];
    expect(factOnlyFrames(frames, CAFE_FACTS)).toEqual([
      {
        frame: 1,
        detail: expect.stringContaining(
          'its headline only gives "₦2,500 a bottle", a receipt line',
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

  it("leaves the hook, the action frame, and where and when to their own checks", () => {
    expect(
      factOnlyFrames(
        [
          priceFrame({ role: "hook" }),
          beatOf({ headline: "Pour one at our Yaba bar" }),
          beatOf({ headline: "Saturday 15 November" }),
          priceFrame({ role: "cta", cta: "Reserve" }),
        ],
        CAFE_FACTS,
      ),
    ).toEqual([]);
  });
});

describe("profilePoints", () => {
  const brand = {
    overview: "Coffee bar in Yaba, Lagos",
    offer: "Specialty coffee and cold brew",
    values: "Patience over shortcuts",
    differentiators: "Beans from the Mambilla Plateau, roasted each week",
    targetAudience: "Students in Yaba",
    primaryGoal: "",
  };

  it("lists the profile's statements, what sets the brand apart first", () => {
    expect(profilePoints(brand, "Launch our cold brew.")).toEqual([
      {
        field: "differentiators",
        text: "Beans from the Mambilla Plateau, roasted each week",
      },
      { field: "offer", text: "Specialty coffee and cold brew" },
      { field: "values", text: "Patience over shortcuts" },
      { field: "targetAudience", text: "Students in Yaba" },
      { field: "overview", text: "Coffee bar in Yaba, Lagos" },
    ]);
  });

  it("leaves out a field the brief already says, and one another field says", () => {
    const points = profilePoints(
      { ...brand, overview: "Students in Yaba" },
      "Patience over shortcuts, every glass.",
    );
    expect(points.map((p) => p.field)).toEqual([
      "differentiators",
      "offer",
      "targetAudience",
    ]);
  });
});

describe("misplacedPrices", () => {
  it("names a carousel price the copy put before the action frame (round-3 critic, finding 3)", () => {
    expect(misplacedPrices(cafePlan().frames, CAFE_FACTS, "carousel")).toEqual([
      {
        frame: 1,
        detail: expect.stringContaining(
          'it gives the price "₦2,500 a bottle", which belongs on frame 5',
        ),
      },
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
