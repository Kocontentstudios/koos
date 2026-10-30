import { describe, expect, it } from "vitest";
import { FRAME_BOUNDS } from "@/lib/design/sequence/contract";
import { cafePlan, withFrame } from "@/lib/design/sequence/fixtures";
import { profilePoints } from "@/lib/design/sequence/points";
import { inBrief } from "@/lib/jobs/directions/brief-read";
import {
  FRAME_COUNTS,
  SEQUENCE_EVAL_CASES,
  SEQUENCE_EVAL_THRESHOLDS,
  SEQUENCE_HELD_OUT_CASES,
} from "./cases";
import {
  buildJudgePrompt,
  judgeSchema,
  judgeScores,
  repairJudgeText,
} from "./judge";
import {
  aggregate,
  failures,
  labelledFacts,
  type RunScore,
  scoreRun,
} from "./score";

const cafe = SEQUENCE_EVAL_CASES.find((c) => c.id === "cafe");
if (!cafe) throw new Error("no cafe case");

describe("SEQUENCE_EVAL_CASES", () => {
  it("covers seven carousels and three presentations", () => {
    const kinds = SEQUENCE_EVAL_CASES.map((c) => c.kind);
    expect(kinds.filter((k) => k === "carousel")).toHaveLength(7);
    expect(kinds.filter((k) => k === "presentation")).toHaveLength(3);
    expect(new Set(SEQUENCE_EVAL_CASES.map((c) => c.id)).size).toBe(10);
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
    for (const c of [...SEQUENCE_EVAL_CASES, ...SEQUENCE_HELD_OUT_CASES]) {
      expect(inBrief(c.offering, c.request.briefText), c.id).not.toBeNull();
      for (const f of c.facts) {
        expect(
          inBrief(f.text, c.request.briefText),
          `${c.id}: ${f.text}`,
        ).not.toBeNull();
      }
    }
  });

  it("gives every brand a profile a thin brief can borrow points from", () => {
    for (const c of [...SEQUENCE_EVAL_CASES, ...SEQUENCE_HELD_OUT_CASES]) {
      for (const field of [
        "overview",
        "offer",
        "values",
        "differentiators",
        "targetAudience",
        "primaryGoal",
      ] as const) {
        expect(c.brand[field]?.trim(), `${c.id}: ${field}`).toBeTruthy();
      }
      expect(
        profilePoints(c.brand, c.request.briefText).length,
        c.id,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps a held-out set of at least three briefs, apart from the tuning set", () => {
    expect(SEQUENCE_HELD_OUT_CASES.length).toBeGreaterThanOrEqual(3);
    /* A held-out brief read while tuning moves to the tuning set, and the
       held-out briefs are new ones. */
    expect(SEQUENCE_HELD_OUT_CASES.map((c) => c.id)).toEqual([
      "tailor",
      "car-wash",
      "exam-prep",
      "cowork-deck",
    ]);
    const tuning = new Set(SEQUENCE_EVAL_CASES.map((c) => c.id));
    const brands = new Set(SEQUENCE_EVAL_CASES.map((c) => c.brand.name));
    for (const c of SEQUENCE_HELD_OUT_CASES) {
      expect(tuning.has(c.id), c.id).toBe(false);
      expect(brands.has(c.brand.name), c.id).toBe(false);
    }
    expect(SEQUENCE_HELD_OUT_CASES.map((c) => c.kind)).toContain(
      "presentation",
    );
    expect(SEQUENCE_HELD_OUT_CASES.map((c) => c.imageSource)).toContain("none");
    /* At least one brief has fewer facts than the longest set has middle
       frames, so the profile is the only honest source left. */
    expect(
      SEQUENCE_HELD_OUT_CASES.some(
        (c) => c.facts.length < Math.max(...FRAME_COUNTS) - 2,
      ),
    ).toBe(true);
  });

  it("freezes the rubric's thresholds", () => {
    expect(SEQUENCE_EVAL_THRESHOLDS).toEqual({
      count: 1,
      roles: 1,
      paletteShared: 1,
      layoutVariety: 1,
      titleClean: 1,
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
      titleClean: true,
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
    expect(
      scoreRun(
        cafe,
        5,
        withFrame(cafePlan(), 2, { title: "Roasted in-house — version A" }),
      ).titleClean,
    ).toBe(false);
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

describe("repairJudgeText", () => {
  const verdict = (why: string) => ({
    hook: { why, score: 3 },
    lastAction: { why: "Clear.", score: 5 },
    nonRepetitive: { why: "Builds.", score: 4 },
  });

  it("shortens a reason past its limit and keeps every score", async () => {
    const long = verdict("x".repeat(520));
    expect(judgeSchema.safeParse(long).success).toBe(false);
    const fixed = JSON.parse(
      (await repairJudgeText({ text: JSON.stringify(long) })) ?? "null",
    );
    const parsed = judgeSchema.safeParse(fixed);
    expect(parsed.success).toBe(true);
    expect(parsed.data && judgeScores(parsed.data)).toEqual({
      hook: 3,
      lastAction: 5,
      nonRepetitive: 4,
    });
  });

  it("leaves anything else to fail", async () => {
    expect(await repairJudgeText({ text: "{ cut" })).toBeNull();
    expect(
      await repairJudgeText({ text: JSON.stringify(verdict("Fine.")) }),
    ).toBeNull();
  });
});

describe("labelledFacts", () => {
  it("reads a venue the brief calls ours as the brand's name and area, as the product does", () => {
    const plan = withFrame(cafePlan(), 3, {
      headline: "Find Kiln Coffee, Yaba",
      subheadline: "",
    });
    const facts = labelledFacts(cafe);
    const venue = facts.find((f) => f.kind === "place");
    expect(venue?.text).toBe("our Yaba bar");
    expect(scoreRun(cafe, 5, plan).uncovered).not.toContain("our Yaba bar");
  });

  it("still misses a venue no frame names", () => {
    const plan = withFrame(cafePlan(), 3, {
      headline: "Find us on Saturday",
      subheadline: "",
    });
    expect(scoreRun(cafe, 5, plan).uncovered).toContain("our Yaba bar");
  });
});
