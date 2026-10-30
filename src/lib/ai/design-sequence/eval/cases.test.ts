import { describe, expect, it } from "vitest";
import { FRAME_BOUNDS } from "@/lib/design/sequence/contract";
import { cafePlan, withFrame } from "@/lib/design/sequence/fixtures";
import { inBrief } from "@/lib/jobs/directions/brief-read";
import {
  FRAME_COUNTS,
  SEQUENCE_EVAL_CASES,
  SEQUENCE_EVAL_THRESHOLDS,
} from "./cases";
import { buildJudgePrompt, judgeSchema, judgeScores } from "./judge";
import { aggregate, failures, type RunScore, scoreRun } from "./score";

const cafe = SEQUENCE_EVAL_CASES.find((c) => c.id === "cafe");
if (!cafe) throw new Error("no cafe case");

describe("SEQUENCE_EVAL_CASES", () => {
  it("covers four carousels and two presentations", () => {
    const kinds = SEQUENCE_EVAL_CASES.map((c) => c.kind);
    expect(kinds.filter((k) => k === "carousel")).toHaveLength(4);
    expect(kinds.filter((k) => k === "presentation")).toHaveLength(2);
    expect(new Set(SEQUENCE_EVAL_CASES.map((c) => c.id)).size).toBe(6);
  });

  it("runs each at frame counts every kind allows", () => {
    for (const c of SEQUENCE_EVAL_CASES) {
      for (const n of FRAME_COUNTS) {
        expect(n).toBeGreaterThanOrEqual(FRAME_BOUNDS[c.kind].min);
        expect(n).toBeLessThanOrEqual(FRAME_BOUNDS[c.kind].max);
      }
    }
  });

  it("labels every fact and offering in the brief's own words", () => {
    for (const c of SEQUENCE_EVAL_CASES) {
      expect(inBrief(c.offering, c.request.briefText), c.id).not.toBeNull();
      for (const f of c.facts) {
        expect(
          inBrief(f.text, c.request.briefText),
          `${c.id}: ${f.text}`,
        ).not.toBeNull();
      }
    }
  });

  it("freezes the rubric's thresholds", () => {
    expect(SEQUENCE_EVAL_THRESHOLDS).toEqual({
      count: 1,
      roles: 1,
      paletteShared: 1,
      layoutVariety: 1,
      factCoverage: 1,
      judgeHook: 4,
      judgeLastAction: 4,
      judgeNonRepetitive: 4,
    });
  });
});

describe("scoreRun", () => {
  it("passes a plan that keeps every rule", () => {
    const score = scoreRun(cafe, 5, cafePlan());
    expect(score).toMatchObject({
      count: true,
      roles: true,
      paletteShared: true,
      layoutVariety: true,
      factCoverage: true,
      uncovered: [],
      offeringOnHook: true,
    });
  });

  it("fails each check on the plan that breaks it", () => {
    expect(scoreRun(cafe, 6, cafePlan()).count).toBe(false);
    expect(
      scoreRun(cafe, 5, withFrame(cafePlan(), 2, { cta: "Buy" })).roles,
    ).toBe(false);
    expect(
      scoreRun(cafe, 5, withFrame(cafePlan(), 2, { layout: "stat-highlight" }))
        .layoutVariety,
    ).toBe(false);
    const dropped = scoreRun(
      cafe,
      5,
      withFrame(cafePlan(), 4, { footerLines: [] }),
    );
    expect(dropped.factCoverage).toBe(false);
    expect(dropped.uncovered).toEqual(["WhatsApp 0803 555 0142"]);
    const unnamed = scoreRun(
      cafe,
      5,
      withFrame(cafePlan(), 0, { headline: "Something new", subheadline: "" }),
    );
    expect(unnamed.offeringOnHook).toBe(false);
    expect(unnamed.factCoverage).toBe(false);
  });

  it("holds a presentation to 16:9", () => {
    const deck = SEQUENCE_EVAL_CASES.find((c) => c.kind === "presentation");
    if (!deck) throw new Error("no deck");
    const plan = cafePlan({ kind: "presentation", aspectRatio: "4:5" });
    expect(scoreRun(deck, 5, plan).paletteShared).toBe(false);
    expect(
      scoreRun(deck, 5, { ...plan, aspectRatio: "16:9" }).paletteShared,
    ).toBe(true);
  });
});

describe("aggregate and failures", () => {
  const pass = scoreRun(cafe, 5, cafePlan());
  const fail: RunScore = { ...pass, factCoverage: false };

  it("passes only when every deterministic check holds on every run", () => {
    const judged = [{ hook: 5, lastAction: 4, nonRepetitive: 4 }];
    expect(failures(aggregate([pass, pass], judged))).toEqual([]);
    expect(failures(aggregate([pass, fail], judged))).toEqual([
      "factCoverage 0.500 < 1",
    ]);
  });

  it("fails a judge average under 4, and never passes an unmeasured judge", () => {
    expect(
      failures(
        aggregate(
          [pass],
          [
            { hook: 5, lastAction: 3, nonRepetitive: 4 },
            { hook: 3, lastAction: 4, nonRepetitive: 4 },
          ],
        ),
      ),
    ).toEqual(["judgeLastAction 3.50 < 4"]);
    expect(failures(aggregate([pass], []))).toEqual([
      "judgeHook not measured",
      "judgeLastAction not measured",
      "judgeNonRepetitive not measured",
    ]);
  });
});

describe("judge", () => {
  it("sends the brief and the frames in order, never the planner's prompts", () => {
    const prompt = buildJudgePrompt(cafe, cafePlan());
    expect(prompt).toContain(cafe.request.briefText);
    expect(prompt).toContain("Frame 1 of 5 (with image)");
    expect(prompt).toContain("button: Message us");
    expect(prompt).not.toContain("earns the swipe. Names");
  });

  it("reads the three scores off a valid answer", () => {
    const answer = judgeSchema.parse({
      hook: { why: "names it", score: 4 },
      lastAction: { why: "clear", score: 5 },
      nonRepetitive: { why: "moves on", score: 3 },
    });
    expect(judgeScores(answer)).toEqual({
      hook: 4,
      lastAction: 5,
      nonRepetitive: 3,
    });
    expect(
      judgeSchema.safeParse({ ...answer, hook: { why: "", score: 6 } }).success,
    ).toBe(false);
  });
});
