import type { PlannedSequence } from "@/lib/design/sequence/contract";
import { PRESENTATION_ASPECT } from "@/lib/design/sequence/contract";
import { frameSpec } from "@/lib/design/sequence/frame-spec";
import {
  factsUncovered,
  validateSequence,
} from "@/lib/design/sequence/validate";
import { type BriefFact, needsFor } from "@/lib/jobs/directions/brief-facts";
import { copyNamesOffering } from "@/lib/jobs/directions/finalize";
import { SEQUENCE_EVAL_THRESHOLDS, type SequenceEvalCase } from "./cases";

/**
 * The eval's deterministic lane. Each score reads the plan or the specs
 * the renderer would draw, with the labelled facts, never the planner's own
 * reading of the brief.
 */

export interface RunScore {
  caseId: string;
  frames: number;
  /** Exactly the frames asked for. */
  count: boolean;
  /** Hook first, cta last, body between, a button on the last frame only. */
  roles: boolean;
  /** Every frame's spec shares one palette, logo, footer system and aspect,
   *  and a presentation is 16:9. */
  paletteShared: boolean;
  /** No frame in its neighbour's layout or composition. */
  layoutVariety: boolean;
  /** Every labelled fact on at least one frame, and the offering named on
   *  the hook. */
  factCoverage: boolean;
  uncovered: string[];
  offeringOnHook: boolean;
  /** Reported, not gated: what still stood after the repair pass. */
  problems: string[];
}

export function labelledFacts(c: SequenceEvalCase): BriefFact[] {
  return c.facts.map((f) => ({ ...f, needs: needsFor(f.kind, f.text) }));
}

function rolesHold(plan: PlannedSequence): boolean {
  const last = plan.frames.length - 1;
  return plan.frames.every((beat, i) => {
    const role = i === 0 ? "hook" : i === last ? "cta" : "body";
    const button = beat.cta.trim().length > 0;
    return beat.role === role && (i === last ? button : !button);
  });
}

function sharedSystem(plan: PlannedSequence, c: SequenceEvalCase): boolean {
  const specs = plan.frames.map((_, i) => frameSpec(plan, i));
  const key = (i: number) =>
    JSON.stringify([
      specs[i].palette,
      specs[i].logoPlacement,
      specs[i].logoFree,
      specs[i].backgroundTreatment,
      specs[i].aspectRatio,
    ]);
  const footers = new Set(
    specs.filter((s) => s.footerStyle !== "none").map((s) => s.footerStyle),
  );
  const aspect =
    c.kind === "presentation" ? PRESENTATION_ASPECT : c.request.aspectRatio;
  return (
    specs.every((_, i) => key(i) === key(0)) &&
    footers.size <= 1 &&
    specs.every((s) => s.aspectRatio === aspect)
  );
}

export function scoreRun(
  c: SequenceEvalCase,
  frames: number,
  plan: PlannedSequence,
): RunScore {
  const facts = labelledFacts(c);
  const problems = validateSequence(plan, {
    frameCount: frames,
    facts,
    offering: c.offering,
    hasImage: c.imageSource !== "none",
    brandName: c.brand.name,
  });
  const uncovered = factsUncovered(plan.frames, facts).map((f) => f.text);
  const hook = plan.frames[0];
  const offeringOnHook = Boolean(hook && copyNamesOffering(hook, c.offering));
  return {
    caseId: c.id,
    frames,
    count: plan.frames.length === frames,
    roles: rolesHold(plan),
    paletteShared: sharedSystem(plan, c),
    layoutVariety: !problems.some((p) => p.rule === "layout-repeat"),
    factCoverage: uncovered.length === 0 && offeringOnHook,
    uncovered,
    offeringOnHook,
    problems: problems.map((p) => `${p.rule}: ${p.detail}`),
  };
}

export const JUDGE_CRITERIA = ["hook", "lastAction", "nonRepetitive"] as const;
export type JudgeCriterion = (typeof JUDGE_CRITERIA)[number];
export type JudgeScores = Record<JudgeCriterion, number>;

export interface Aggregate {
  runs: number;
  count: number;
  roles: number;
  paletteShared: number;
  layoutVariety: number;
  factCoverage: number;
  /** Null when no run was judged. */
  judgeHook: number | null;
  judgeLastAction: number | null;
  judgeNonRepetitive: number | null;
  judged: number;
}

const share = (runs: readonly RunScore[], pick: (r: RunScore) => boolean) =>
  runs.length === 0 ? 0 : runs.filter(pick).length / runs.length;

const mean = (values: readonly number[]) =>
  values.length === 0
    ? null
    : values.reduce((a, b) => a + b, 0) / values.length;

export function aggregate(
  runs: readonly RunScore[],
  judged: readonly JudgeScores[],
): Aggregate {
  return {
    runs: runs.length,
    count: share(runs, (r) => r.count),
    roles: share(runs, (r) => r.roles),
    paletteShared: share(runs, (r) => r.paletteShared),
    layoutVariety: share(runs, (r) => r.layoutVariety),
    factCoverage: share(runs, (r) => r.factCoverage),
    judgeHook: mean(judged.map((j) => j.hook)),
    judgeLastAction: mean(judged.map((j) => j.lastAction)),
    judgeNonRepetitive: mean(judged.map((j) => j.nonRepetitive)),
    judged: judged.length,
  };
}

/** Every threshold the aggregate misses, in words. A judge score that was
 *  not measured (--no-judge) is reported as unmeasured, never as a pass. */
export function failures(
  agg: Aggregate,
  thresholds = SEQUENCE_EVAL_THRESHOLDS,
): string[] {
  const out: string[] = [];
  for (const key of [
    "count",
    "roles",
    "paletteShared",
    "layoutVariety",
    "factCoverage",
  ] as const) {
    if (agg[key] < thresholds[key]) {
      out.push(`${key} ${agg[key].toFixed(3)} < ${thresholds[key]}`);
    }
  }
  for (const key of [
    "judgeHook",
    "judgeLastAction",
    "judgeNonRepetitive",
  ] as const) {
    const value = agg[key];
    if (value === null) out.push(`${key} not measured`);
    else if (value < thresholds[key]) {
      out.push(`${key} ${value.toFixed(2)} < ${thresholds[key]}`);
    }
  }
  return out;
}
