import {
  correctableFieldsFor,
  type DesignRenderer,
  type JudgedCorrection,
  MAX_SCORE,
  MIN_SCORE,
  prescribableFields,
  prescriptionOutcome,
  type RefusalReason,
  RUBRIC_CATEGORIES,
} from "@/lib/design/quality/judge";
import type { DesignSpec } from "@/lib/design/spec";
import type { DesignJudgeEvalThresholds } from "./cases";

/**
 * Deterministic scoring for `eval:design-judge`.
 *
 * Every question here has exactly one correct answer given the judge's own
 * output, so none of it goes to a second model: whether a verdict came back,
 * which guard refused the prescription, whether the route draws the field,
 * whether the spec actually changed, and whether §11 treats the named symptom
 * with the field that was named. Only the judgement itself is paid for.
 *
 * Pure: no model call, no file I/O, no clock.
 */

/** The guards, plus the one `judgeAndCorrect` applies before `correct()`. */
export type JudgeRefusal = RefusalReason | "outside-symptom-map";

/** What the lane needs to know about a case to score its result. */
export interface JudgeCaseFacts {
  id: string;
  renderer: DesignRenderer;
  /** The spec that failed — the baseline every "did it change" answer needs. */
  spec: DesignSpec;
  hasLogo: boolean;
  /** Whether there were readable bytes worth showing: a real render and no
   *  blank-frame fault. `visualEvidence` withholds everything else. */
  expectSawImage: boolean;
}

export interface DesignJudgeCaseScore {
  id: string;
  renderer: DesignRenderer;
  /** The judge answered with ten scores, a symptom and a prescription. */
  verdictReturned: boolean;
  /** The prescription survived every guard. The headline metric. */
  accepted: boolean;
  /** Which guard turned it down, re-derived from the recorded verdict.
   *  Null when it was accepted, when no verdict came back, or — and this
   *  should never happen — when no guard accounts for the refusal. */
  refusedBy: JudgeRefusal | null;
  /** The prescribed field is one this route actually draws. False is a hard
   *  failure: it is the bodyPoints defect reached through the judge. */
  fieldDrawn: boolean | null;
  /** §11 treats the symptom the judge named with the field it prescribed. */
  symptomTreatsField: boolean | null;
  /** The returned spec really differs from the one that failed. False on an
   *  accepted prescription is a hard failure: a byte-identical second render
   *  reported as a correction is the defect this module removes. */
  specChanged: boolean | null;
  /** All ten scores are whole numbers inside §10's 1-5 scale. */
  scoresInRange: boolean | null;
  /** The judge looked at the render exactly when there was one to look at. */
  sawImageAsExpected: boolean;
  /* Everything below is for the human reading the report: what the judge
     actually said, in its own words. */
  symptom: string | null;
  weakest: string | null;
  total: number | null;
  seriousFailure: boolean | null;
  prescribedField: string | null;
  prescribedValue: string | null;
  reason: string | null;
  appliedFrom: string | null;
  appliedTo: string | null;
}

function allScoresInRange(scores: Record<string, number>): boolean {
  return RUBRIC_CATEGORIES.every((category) => {
    const score = scores[category];
    return Number.isInteger(score) && score >= MIN_SCORE && score <= MAX_SCORE;
  });
}

/* Structural comparison rather than reference identity: `judgeAndCorrect`
   returns a fresh object from designSpecSchema.parse on every accepted
   prescription, so `result.spec !== facts.spec` is true even when nothing in
   it moved. The whole point of the check is what the renderer would see. */
function sameSpec(a: DesignSpec, b: DesignSpec): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function scoreDesignJudgeCase(
  facts: JudgeCaseFacts,
  result: JudgedCorrection,
): DesignJudgeCaseScore {
  const { renderer, hasLogo } = facts;
  const { verdict } = result;

  const base = {
    id: facts.id,
    renderer,
    sawImageAsExpected: (verdict?.sawImage ?? false) === facts.expectSawImage,
  };

  if (!verdict) {
    return {
      ...base,
      verdictReturned: false,
      accepted: false,
      refusedBy: null,
      fieldDrawn: null,
      symptomTreatsField: null,
      specChanged: null,
      scoresInRange: null,
      symptom: null,
      weakest: null,
      total: null,
      seriousFailure: null,
      prescribedField: null,
      prescribedValue: null,
      reason: null,
      appliedFrom: null,
      appliedTo: null,
    };
  }

  const { field, value } = verdict.change;
  const fieldDrawn = correctableFieldsFor(renderer, hasLogo).includes(field);
  const symptomTreatsField = prescribableFields(
    verdict.symptom,
    renderer,
    hasLogo,
  ).includes(field);

  /* The same ladder `correct()` walks, in the same order, re-derived from the
     recorded prescription. `prescriptionOutcome` is pure and total, so this
     reproduces the module's own decision rather than guessing at it. */
  const outcome = prescriptionOutcome(
    facts.spec,
    { field, value },
    renderer,
    hasLogo,
  );
  const refusedBy: JudgeRefusal | null = result.corrected
    ? null
    : !fieldDrawn
      ? "field-not-drawn"
      : !symptomTreatsField
        ? "outside-symptom-map"
        : outcome.ok
          ? null
          : outcome.refusedBy;

  return {
    ...base,
    verdictReturned: true,
    accepted: result.corrected,
    refusedBy,
    fieldDrawn,
    symptomTreatsField,
    specChanged: result.corrected ? !sameSpec(result.spec, facts.spec) : null,
    scoresInRange: allScoresInRange(verdict.scores),
    symptom: verdict.symptom,
    weakest: verdict.weakest,
    total: RUBRIC_CATEGORIES.reduce(
      (sum, category) => sum + verdict.scores[category],
      0,
    ),
    seriousFailure: verdict.seriousFailure,
    prescribedField: field,
    prescribedValue: value,
    reason: verdict.reason,
    appliedFrom: result.applied?.from ?? null,
    appliedTo: result.applied?.to ?? null,
  };
}

export interface DesignJudgeTotals {
  cases: number;
  verdictRate: number;
  /** The headline: prescriptions that survived every guard. */
  acceptanceRate: number;
  symptomTreatsField: number;
  scoresInRange: number;
  sawImageAsExpected: number;
  /** How often each guard did the refusing, worst-understood first in the
   *  report. This is what tunes the guards and the field guide. */
  refusals: Record<string, number>;
  /** Hard failures. Each is a defect, not a low score. */
  undrawnFields: string[];
  unchangedCorrections: string[];
  /** A refusal no guard accounts for — the lane disagreeing with the module. */
  unattributedRefusals: string[];
}

function share(values: boolean[]): number {
  if (values.length === 0) return 1;
  return values.filter(Boolean).length / values.length;
}

function defined(values: (boolean | null)[]): boolean[] {
  return values.filter((value): value is boolean => value !== null);
}

export function aggregateDesignJudge(
  scores: DesignJudgeCaseScore[],
): DesignJudgeTotals {
  const refusals: Record<string, number> = {};
  for (const score of scores) {
    if (score.refusedBy) {
      refusals[score.refusedBy] = (refusals[score.refusedBy] ?? 0) + 1;
    }
  }

  return {
    cases: scores.length,
    verdictRate: share(scores.map((s) => s.verdictReturned)),
    acceptanceRate: share(scores.map((s) => s.accepted)),
    symptomTreatsField: share(defined(scores.map((s) => s.symptomTreatsField))),
    scoresInRange: share(defined(scores.map((s) => s.scoresInRange))),
    sawImageAsExpected: share(scores.map((s) => s.sawImageAsExpected)),
    refusals,
    undrawnFields: scores
      .filter((s) => s.fieldDrawn === false)
      .map((s) => s.id),
    unchangedCorrections: scores
      .filter((s) => s.accepted && s.specChanged === false)
      .map((s) => s.id),
    unattributedRefusals: scores
      .filter((s) => s.verdictReturned && !s.accepted && s.refusedBy === null)
      .map((s) => s.id),
  };
}

export function designJudgePassed(
  totals: DesignJudgeTotals,
  thresholds: DesignJudgeEvalThresholds,
): boolean {
  return (
    totals.undrawnFields.length === 0 &&
    totals.unchangedCorrections.length === 0 &&
    totals.unattributedRefusals.length === 0 &&
    totals.verdictRate >= thresholds.minVerdictRate &&
    totals.acceptanceRate >= thresholds.minAcceptanceRate &&
    totals.symptomTreatsField >= thresholds.minSymptomTreatsField &&
    totals.scoresInRange >= thresholds.minScoresInRange &&
    totals.sawImageAsExpected >= thresholds.minSawImageAsExpected
  );
}
