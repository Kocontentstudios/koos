import { z } from "zod";
import type { SequenceRule } from "@/lib/design/sequence/contract";
import type { JudgedSet } from "./judge";
import type { JudgeScores } from "./score";

/**
 * The calibration panel of rubric Addendum B: the 8 fixtures the expert
 * reference was written for, at the reference's N. Our sets (lane
 * APPROVED) are judged blind, shuffled in with the frozen expert and floor
 * sets, and H13 is gated relative to the expert's means instead of an
 * absolute 4.0 the judge never gave expert work.
 */

export const PANEL_GROUPS = ["expert", "ours", "floor"] as const;
export type PanelGroup = (typeof PANEL_GROUPS)[number];
export const PANEL_AXES = ["hook", "lastAction", "nonRepetitive"] as const;
export type PanelAxis = (typeof PANEL_AXES)[number];

export const PANEL_PASSES = 3;
export const EXPERT_MARGIN = 0.2;
export const FLOOR_MARGIN = 1.5;
export const ABSOLUTE_BAR = 4.0;
/* Addendum B's acceptance of the judge fix itself, read on every panel
   run so a judge that drifts is caught where it is used. */
export const CALIBRATION_FLOOR_GAP = 1.5;
export const CALIBRATION_WITHIN_SD_MAX = 0.4;

/* Means of integer scores over 24 judgments land on fractions such as
   3.4 - 0.2, which floating point puts a hair under the bar. */
const EPSILON = 1e-9;

/** Pinned by reference.test.ts: a reference edited by anyone fails the
 *  gate lane. */
export const REFERENCE_SHA256 = {
  expert: "0d3a705e3c3942af31a4ab8f80bc451751e99dd3a859b563a66fb3c5005ca83f",
  floor: "c217d4630a38034e4fb19825ab735f052996b498307686bebea71abf4ce8e605",
} as const;

export const REFERENCE_FILES = {
  expert: "src/lib/ai/design-sequence/eval/reference/expert.json",
  floor: "src/lib/ai/design-sequence/eval/reference/floor.json",
} as const;

const referenceFrame = z.object({
  headline: z.string(),
  subheadline: z.string(),
  footerLines: z.array(z.string()),
  cta: z.string(),
  showsImage: z.boolean(),
});

export const referenceSetSchema = z.object({
  fixtureId: z.string(),
  kind: z.enum(["carousel", "presentation"]),
  frames: z.array(referenceFrame).min(1),
});

export type PanelSet = z.infer<typeof referenceSetSchema> & JudgedSet;

export function parseReference(text: string): PanelSet[] {
  return z.array(referenceSetSchema).parse(JSON.parse(text));
}

/* Mirrors FATAL_RULES in src/lib/jobs/run-design-sequence.ts, which is not
   exported and drags the job's server imports with it. reference.test.ts
   reads that file and fails if the two lists part. */
export const JOB_FATAL_RULES: readonly SequenceRule[] = [
  "count",
  "hook-first",
  "cta-last",
  "cta-only-last",
  "headline-repeat",
  "offering-unnamed",
];

/** Faults on one of our sets that must not ship: what the planner reports
 *  and production would refuse (onBlocked "refuse"), plus what the job
 *  refuses after planning (a fatal validateSequence rule, a wrong count). */
export function blockingFaults(input: {
  frameCount: number;
  plannedFrames: number;
  refused: { frame: number; detail: string }[];
  problems: { frame: number | null; rule: SequenceRule; detail: string }[];
}): string[] {
  return [
    ...input.refused.map((r) => `frame ${r.frame + 1}: ${r.detail}`),
    ...input.problems
      .filter((p) => JOB_FATAL_RULES.includes(p.rule))
      .map(
        (p) =>
          `${p.frame === null ? "set" : `frame ${p.frame + 1}`}: ${p.rule}: ${p.detail}`,
      ),
    ...(input.plannedFrames === input.frameCount
      ? []
      : [`set: count: planned ${input.plannedFrames} of ${input.frameCount}`]),
  ];
}

export interface PanelJob {
  group: PanelGroup;
  fixtureId: string;
  pass: number;
}

/** Every group's set judged `passes` times, in one order no group can be
 *  read from (Fisher-Yates on `random`). */
export function panelJobs(
  fixtureIds: readonly string[],
  passes: number,
  random: () => number,
): PanelJob[] {
  const jobs = PANEL_GROUPS.flatMap((group) =>
    fixtureIds.flatMap((fixtureId) =>
      Array.from({ length: passes }, (_, pass) => ({ group, fixtureId, pass })),
    ),
  );
  for (let i = jobs.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
  }
  return jobs;
}

export interface PanelJudgment extends PanelJob {
  scores: JudgeScores | null;
}

export type AxisMeans = Record<PanelAxis, number | null>;

export interface GroupSummary {
  means: AxisMeans;
  /** Mean over the group's sets of each set's sd across its passes. */
  withinSd: AxisMeans;
  judged: number;
  failed: number;
}

const mean = (xs: number[]) =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

function sd(xs: number[]): number {
  const m = mean(xs) ?? 0;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}

export function summarizeGroup(
  judgments: PanelJudgment[],
  group: PanelGroup,
): GroupSummary {
  const mine = judgments.filter((j) => j.group === group);
  const scored = mine.flatMap((j) =>
    j.scores ? [{ fixtureId: j.fixtureId, scores: j.scores }] : [],
  );
  const fixtureIds = [...new Set(scored.map((s) => s.fixtureId))];
  const axisOf = (axis: PanelAxis) => {
    const sets = fixtureIds.map((id) =>
      scored.filter((s) => s.fixtureId === id).map((s) => s.scores[axis]),
    );
    return {
      mean: mean(scored.map((s) => s.scores[axis])),
      withinSd: mean(sets.map(sd)),
    };
  };
  const axes = Object.fromEntries(
    PANEL_AXES.map((axis) => [axis, axisOf(axis)]),
  ) as Record<PanelAxis, { mean: number | null; withinSd: number | null }>;
  return {
    means: Object.fromEntries(
      PANEL_AXES.map((a) => [a, axes[a].mean]),
    ) as AxisMeans,
    withinSd: Object.fromEntries(
      PANEL_AXES.map((a) => [a, axes[a].withinSd]),
    ) as AxisMeans,
    judged: scored.length,
    failed: mine.length - scored.length,
  };
}

export interface GateCheck {
  name: string;
  pass: boolean;
  detail: string;
}

const fmt = (x: number | null) => (x === null ? "n/a" : x.toFixed(2));
const atLeast = (x: number | null, bar: number | null) =>
  x !== null && bar !== null && x + EPSILON >= bar;

/** Addendum B's H13: per axis ours >= expert - 0.2 and >= floor + 1.5,
 *  4.0 wherever expert reaches 4.0; no blocking fault on any of our sets;
 *  and every judgment measured, since a missing one skews a mean. */
export function panelGate(input: {
  summary: Record<PanelGroup, GroupSummary>;
  blockingFaultsShipped: number;
}): GateCheck[] {
  const { expert, ours, floor } = input.summary;
  const perAxis = PANEL_AXES.flatMap((axis): GateCheck[] => {
    const e = expert.means[axis];
    const o = ours.means[axis];
    const f = floor.means[axis];
    const expertBar = e === null ? null : e - EXPERT_MARGIN;
    const floorBar = f === null ? null : f + FLOOR_MARGIN;
    const checks: GateCheck[] = [
      {
        name: `${axis}: ours >= expert - ${EXPERT_MARGIN}`,
        pass: atLeast(o, expertBar),
        detail: `ours ${fmt(o)}, expert ${fmt(e)}, bar ${fmt(expertBar)}`,
      },
      {
        name: `${axis}: ours >= floor + ${FLOOR_MARGIN}`,
        pass: atLeast(o, floorBar),
        detail: `ours ${fmt(o)}, floor ${fmt(f)}, bar ${fmt(floorBar)}`,
      },
    ];
    if (atLeast(e, ABSOLUTE_BAR)) {
      checks.push({
        name: `${axis}: ours >= ${ABSOLUTE_BAR} (expert reaches it)`,
        pass: atLeast(o, ABSOLUTE_BAR),
        detail: `ours ${fmt(o)}, expert ${fmt(e)}`,
      });
    }
    return checks;
  });
  const failedCalls = PANEL_GROUPS.reduce(
    (n, g) => n + input.summary[g].failed,
    0,
  );
  return [
    ...perAxis,
    {
      name: "blocking faults shipped = 0",
      pass: input.blockingFaultsShipped === 0,
      detail: `${input.blockingFaultsShipped} on our sets`,
    },
    {
      name: "every judgment measured",
      pass: failedCalls === 0,
      detail: `${failedCalls} judge calls failed`,
    },
  ];
}

/** Addendum B's acceptance of the judge itself: it still rejects the floor
 *  by 1.5 on every axis, and its passes on one set agree within 0.4. */
export function calibrationChecks(
  summary: Record<PanelGroup, GroupSummary>,
): GateCheck[] {
  return PANEL_AXES.flatMap((axis): GateCheck[] => {
    const e = summary.expert.means[axis];
    const f = summary.floor.means[axis];
    const gap = e === null || f === null ? null : e - f;
    const worstSd = Math.max(
      ...PANEL_GROUPS.map((g) => summary[g].withinSd[axis] ?? Infinity),
    );
    return [
      {
        name: `${axis}: expert - floor >= ${CALIBRATION_FLOOR_GAP}`,
        pass: atLeast(gap, CALIBRATION_FLOOR_GAP),
        detail: `gap ${fmt(gap)}`,
      },
      {
        name: `${axis}: within-set sd <= ${CALIBRATION_WITHIN_SD_MAX}`,
        pass: worstSd <= CALIBRATION_WITHIN_SD_MAX + EPSILON,
        detail: `worst group ${Number.isFinite(worstSd) ? worstSd.toFixed(2) : "n/a"}`,
      },
    ];
  });
}
