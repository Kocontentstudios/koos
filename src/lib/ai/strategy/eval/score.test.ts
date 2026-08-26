import { describe, expect, it } from "vitest";
import type { Strategy } from "@/lib/ai/strategy-schema";
import type { StrategyEvalCase } from "./cases";
import { STRATEGY_EVAL_THRESHOLDS } from "./cases";
import {
  aggregateStrategy,
  scoreStrategyCase,
  strategyCasePassed,
} from "./score";

const evalCase: StrategyEvalCase = {
  id: "yaba-store",
  brand: {
    name: "Lagos Loom",
    overview: "",
    targetAudience: "",
    tone: "",
  },
  transcript: "",
  nameAnchors: ["yaba", "store"],
  objectiveAnchors: [["1000"], ["opening", "open week"]],
  strayTopics: ["podcast", "hiring"],
};

const strategy = (over: Partial<Strategy> = {}): Strategy => ({
  campaignName: "Yaba Store Opening",
  objective: "Bring 1000 people through the door in the opening week",
  targetAudience: "Lagos shoppers",
  keyMessage: "Come see the loom",
  channels: [{ name: "Instagram", rationale: "reach" }],
  contentMix: [{ type: "Reel", count: 4 }],
  timeline: [{ phase: "Tease", dateRange: "Week 1", focus: "hype" }],
  themes: [{ title: "Craft", description: "weaving" }],
  postingSchedule: [{ channel: "Instagram", cadence: "daily" }],
  ...over,
});

const score = (over: Partial<Strategy> = {}) =>
  scoreStrategyCase(
    evalCase,
    strategy(over),
    STRATEGY_EVAL_THRESHOLDS.maxNameLength,
  );

describe("scoreStrategyCase", () => {
  it("passes a focused campaign", () => {
    const s = score();
    expect(s.nameFocus).toBe(1);
    expect(s.objectiveFocus).toBe(1);
    expect(s.mixedTopics).toEqual([]);
    expect(s.shapeErrors).toEqual([]);
    expect(strategyCasePassed(s, STRATEGY_EVAL_THRESHOLDS)).toBe(true);
  });

  it("fails a campaign named after nothing the chat was about", () => {
    const s = score({ campaignName: "Brand Awareness Push" });
    expect(s.nameFocus).toBe(0);
    expect(strategyCasePassed(s, STRATEGY_EVAL_THRESHOLDS)).toBe(false);
  });

  /* The mixing failure: the user set the podcast aside, so a campaign name
     that still carries it merged two campaigns into one chat. */
  it("flags a campaign name carrying a topic the user set aside", () => {
    const s = score({ campaignName: "Yaba Store Opening & Podcast Launch" });
    expect(s.mixedTopics).toEqual(["podcast"]);
    expect(strategyCasePassed(s, STRATEGY_EVAL_THRESHOLDS)).toBe(false);
  });

  it("scores partial objective anchors proportionally", () => {
    const s = score({
      objective: "Fill the shop on opening day",
      keyMessage: "Come see the loom",
    });
    expect(s.objectiveFocus).toBe(0.5);
  });

  /* A model writes "1,000"; the anchor says "1000". Same fact. Without digit
     normalization the eval fails a correct strategy. */
  it("matches a number written with thousands separators", () => {
    const s = score({
      objective: "Drive 1,000 visitors in the opening week",
    });
    expect(s.objectiveFocus).toBe(1);
  });

  /* A group is alternate phrasings of ONE fact, so any alternate satisfies it.
     Scoring them conjunctively would measure vocabulary, not focus. */
  it("counts an anchor group once when any alternate lands", () => {
    const s = score({
      objective: "Fill the shop during open week",
      keyMessage: "1000 people",
    });
    expect(s.objectiveFocus).toBe(1);
  });

  it("rejects a boilerplate campaign name", () => {
    const s = score({ campaignName: "Campaign for Yaba Store" });
    expect(s.shapeErrors).toContain("boilerplate campaign name prefix");
  });

  it("rejects a name too long for the card and the sidebar", () => {
    const s = score({ campaignName: `Yaba Store ${"x".repeat(60)}` });
    expect(s.shapeErrors).toContain("campaign name over 60 chars");
  });

  it("rejects a strategy that cannot render a card", () => {
    const s = score({ channels: [], timeline: [] });
    expect(s.shapeErrors).toEqual(["no channels", "no timeline phases"]);
  });

  it("treats a case with no objective anchors as fully satisfied", () => {
    const s = scoreStrategyCase(
      { ...evalCase, objectiveAnchors: [] },
      strategy(),
      60,
    );
    expect(s.objectiveFocus).toBe(1);
  });
});

describe("aggregateStrategy", () => {
  it("averages focus and totals the failures", () => {
    const good = score();
    const bad = score({ campaignName: "Podcast Launch" });
    expect(aggregateStrategy([good, bad])).toEqual({
      nameFocus: 0.5,
      objectiveFocus: 1,
      mixed: 1,
      shapeErrors: 0,
    });
  });

  it("scores an empty run at zero rather than dividing by zero", () => {
    expect(aggregateStrategy([]).nameFocus).toBe(0);
  });
});
