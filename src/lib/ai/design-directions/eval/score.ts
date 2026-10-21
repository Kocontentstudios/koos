import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import {
  finalizeDirection,
  groundingFacts,
} from "@/lib/jobs/directions/finalize";
import {
  DIRECTION_REASON_MAX,
  DIRECTION_REASONS_MAX,
  DIRECTION_REASONS_MIN,
  DIRECTION_TITLE_MAX,
  type DirectionDraft,
  type DirectionSpec,
  directionSpecSchema,
} from "@/lib/jobs/directions/schema";
import {
  contentStems,
  directionOverlap,
  distinctness,
  isGroundedReason,
  isNearDuplicate,
  soundsLikeFiller,
  usesJargon,
} from "@/lib/jobs/directions/text-overlap";
import type { DIRECTIONS_EVAL_THRESHOLDS, DirectionsEvalCase } from "./cases";

/**
 * Deterministic scoring for the directions eval. Every metric has one right
 * answer given the model's output, so none of it is asked of a judge; only
 * the generation is paid.
 */

export interface DirectionsCaseScore {
  id: string;
  twoDirections: boolean;
  /** After the forcing rule: what the user sees. */
  layoutsDiffer: boolean;
  /** The model's own layouts, before the rule: how often it is needed. */
  modelLayoutsDiffer: boolean;
  /** After finalising: the stored contract. */
  withinLimits: boolean;
  /** The model's own titles and reasons, before finalising. */
  modelWithinLimits: boolean;
  reasons: number;
  grounded: number;
  filler: number;
  /** Layout ids, hex codes or prompt talk in a delivered reason. */
  jargon: number;
  /** Delivered reasons that are a model reason shortened to fit. */
  cut: number;
  /** The model's own reasons before finalising, for the share it grounds
   *  unaided. */
  modelReasons: number;
  modelGrounded: number;
  /** The first call's pair, before any redraft. */
  firstNearDuplicate: boolean;
  finalNearDuplicate: boolean;
  /** 1 - worst word overlap of the delivered pair. */
  distinctness: number;
  redrafted: boolean;
  modelCalls: number;
  titles: string[];
  headlines: string[];
  layouts: string[];
}

function modelWithinLimits(draft: DirectionDraft): boolean {
  return (
    draft.title.trim().length <= DIRECTION_TITLE_MAX &&
    draft.rationale.length >= DIRECTION_REASONS_MIN &&
    draft.rationale.length <= DIRECTION_REASONS_MAX &&
    draft.rationale.every((r) => r.trim().length <= DIRECTION_REASON_MAX)
  );
}

export function factsFor(testCase: DirectionsEvalCase): Set<string> {
  const brand: BrandSummary = testCase.brand;
  return groundingFacts([
    testCase.request.briefText,
    testCase.request.title,
    testCase.request.designType,
    brand.name,
    brand.overview,
    brand.targetAudience,
    brand.tone,
    brand.offer,
  ]);
}

export function scoreDirectionsCase(
  testCase: DirectionsEvalCase,
  result: {
    directions: DirectionSpec[];
    drafts: DirectionDraft[];
    redrafted: boolean;
    modelCalls: number;
  },
): DirectionsCaseScore {
  const { directions, drafts } = result;
  const facts = factsFor(testCase);
  const ignore = contentStems(testCase.brand.name);
  const options = {
    compareScenes: testCase.imageSource === "ko",
    ignore,
    briefWords: contentStems(
      `${testCase.request.briefText} ${testCase.request.title}`,
    ),
  };

  const reasons = directions.flatMap((d) => d.rationale);
  const grounded = reasons.filter((r) => isGroundedReason(r, facts)).length;
  const filler = reasons.filter(
    (r) => soundsLikeFiller(r) && !isGroundedReason(r, facts),
  ).length;
  const modelReasons = drafts.flatMap((d) => d.rationale);

  /* The first call's pair, put through the same finalising the product
     applies, so a long reason is not mistaken for a different concept. */
  const firstPair = drafts.map((d) =>
    finalizeDirection(d, {
      aspectRatio: testCase.request.aspectRatio,
      facts,
      fallbackReasons: [],
      fallbackTitle: d.title,
    }),
  );
  const firstOverlap =
    firstPair.length === 2
      ? directionOverlap(firstPair[0], firstPair[1], options)
      : null;
  const finalOverlap =
    directions.length === 2
      ? directionOverlap(directions[0], directions[1], options)
      : null;

  return {
    id: testCase.id,
    twoDirections: directions.length === 2,
    layoutsDiffer:
      directions.length === 2 && directions[0].layout !== directions[1].layout,
    modelLayoutsDiffer:
      drafts.length === 2 && drafts[0].layout !== drafts[1].layout,
    withinLimits: directions.every(
      (d) => directionSpecSchema.safeParse(d).success,
    ),
    modelWithinLimits: drafts.every(modelWithinLimits),
    reasons: reasons.length,
    grounded,
    filler,
    jargon: reasons.filter(usesJargon).length,
    cut: reasons.filter((r) =>
      modelReasons.some((raw) => {
        const whole = raw.replace(/\s+/g, " ").trim();
        return whole !== r && whole.startsWith(r);
      }),
    ).length,
    modelReasons: modelReasons.length,
    modelGrounded: modelReasons.filter((r) => isGroundedReason(r, facts))
      .length,
    firstNearDuplicate: firstOverlap ? isNearDuplicate(firstOverlap) : true,
    finalNearDuplicate: finalOverlap ? isNearDuplicate(finalOverlap) : true,
    distinctness: finalOverlap ? distinctness(finalOverlap) : 0,
    redrafted: result.redrafted,
    modelCalls: result.modelCalls,
    titles: directions.map((d) => d.title),
    headlines: directions.map((d) => d.headline),
    layouts: directions.map((d) => d.layout),
  };
}

export interface DirectionsTotals {
  cases: number;
  twoDirections: number;
  layoutsDiffer: number;
  modelLayoutsDiffer: number;
  withinLimits: number;
  modelWithinLimits: number;
  groundedShare: number;
  modelGroundedShare: number;
  fillerShare: number;
  jargonShare: number;
  cutShare: number;
  meanDistinctness: number;
  minDistinctness: number;
  firstNearDuplicates: number;
  finalNearDuplicates: number;
  redrafts: number;
  modelCalls: number;
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function share(values: boolean[]): number {
  return values.length === 0
    ? 0
    : values.filter(Boolean).length / values.length;
}

export function aggregateDirections(
  scores: DirectionsCaseScore[],
): DirectionsTotals {
  const reasons = scores.reduce((n, s) => n + s.reasons, 0);
  const distinct = scores.map((s) => s.distinctness);
  return {
    cases: scores.length,
    twoDirections: share(scores.map((s) => s.twoDirections)),
    layoutsDiffer: share(scores.map((s) => s.layoutsDiffer)),
    modelLayoutsDiffer: share(scores.map((s) => s.modelLayoutsDiffer)),
    withinLimits: share(scores.map((s) => s.withinLimits)),
    modelWithinLimits: share(scores.map((s) => s.modelWithinLimits)),
    groundedShare:
      reasons === 0 ? 0 : scores.reduce((n, s) => n + s.grounded, 0) / reasons,
    modelGroundedShare: ratio(
      scores.reduce((n, s) => n + s.modelGrounded, 0),
      scores.reduce((n, s) => n + s.modelReasons, 0),
    ),
    fillerShare:
      reasons === 0 ? 0 : scores.reduce((n, s) => n + s.filler, 0) / reasons,
    jargonShare: ratio(
      scores.reduce((n, s) => n + s.jargon, 0),
      reasons,
    ),
    cutShare: ratio(
      scores.reduce((n, s) => n + s.cut, 0),
      reasons,
    ),
    meanDistinctness:
      distinct.length === 0
        ? 0
        : distinct.reduce((a, b) => a + b, 0) / distinct.length,
    minDistinctness: distinct.length === 0 ? 0 : Math.min(...distinct),
    firstNearDuplicates: scores.filter((s) => s.firstNearDuplicate).length,
    finalNearDuplicates: scores.filter((s) => s.finalNearDuplicate).length,
    redrafts: scores.filter((s) => s.redrafted).length,
    modelCalls: scores.reduce((n, s) => n + s.modelCalls, 0),
  };
}

export function directionsPassed(
  totals: DirectionsTotals,
  t: typeof DIRECTIONS_EVAL_THRESHOLDS,
  expectedCases: number,
): boolean {
  return (
    totals.cases === expectedCases &&
    totals.twoDirections >= t.minTwoDirections &&
    totals.layoutsDiffer >= t.minLayoutsDiffer &&
    totals.withinLimits >= t.minWithinLimits &&
    totals.groundedShare >= t.minGroundedShare &&
    totals.fillerShare <= t.maxFillerShare &&
    totals.jargonShare <= t.maxJargonShare &&
    totals.cutShare <= t.maxCutShare &&
    totals.meanDistinctness >= t.minMeanDistinctness &&
    totals.finalNearDuplicates <= t.maxFinalNearDuplicates
  );
}
