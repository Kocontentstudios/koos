import { describe, expect, it } from "vitest";
import { strategySchema } from "./strategy-schema";

const VALID = {
  campaignName: "The Fresh Drop",
  objective: "Drive 300+ pre-orders in 21 days",
  targetAudience: "Women 22-38, urban, skincare-curious",
  keyMessage: "Clean beauty in 3 steps.",
  channels: [{ name: "Instagram", rationale: "Primary buzz" }],
  contentMix: [{ type: "Carousel", count: 6 }],
  timeline: [
    { phase: "Teaser", dateRange: "Days 1-7", focus: "Build anticipation" },
  ],
  themes: [
    { title: "Behind the Scenes", description: "How we source ingredients" },
  ],
  postingSchedule: [{ channel: "Instagram", cadence: "Tue/Thu 9am" }],
};

describe("strategySchema", () => {
  it("parses a valid strategy", () => {
    expect(strategySchema.parse(VALID)).toMatchObject({
      campaignName: "The Fresh Drop",
    });
  });
  it("requires at least one channel", () => {
    expect(strategySchema.safeParse({ ...VALID, channels: [] }).success).toBe(
      false,
    );
  });
  it("rejects a missing required scalar", () => {
    const { keyMessage, ...rest } = VALID;
    expect(strategySchema.safeParse(rest).success).toBe(false);
  });
  it("rejects a negative contentMix count", () => {
    expect(
      strategySchema.safeParse({
        ...VALID,
        contentMix: [{ type: "Reel", count: -1 }],
      }).success,
    ).toBe(false);
  });
});
