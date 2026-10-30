import { describe, expect, it } from "vitest";
import type { FrameBeat } from "./contract";
import { beatOf, CAFE_FACTS, cafePlan, fact } from "./fixtures";
import { factOnlyFrames } from "./points";

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
