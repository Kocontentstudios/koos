import {
  type DrawnCopy,
  factLedger,
  inventedFacts,
  looksCutOff,
  reasonHolds,
  spatialClaim,
} from "@/lib/jobs/directions/claims";
import {
  type DirectionChecks,
  groundingAnchors,
  isGrounded,
} from "@/lib/jobs/directions/finalize";
import type { PlateCheck } from "@/lib/jobs/directions/imagery";
import {
  COPY_LIMITS,
  DIRECTION_REASONS_MAX,
  DIRECTION_REASONS_MIN,
  type DirectionDraft,
  type DirectionSpec,
  directionSpecSchema,
} from "@/lib/jobs/directions/schema";
import {
  contentStems,
  type DirectionOverlap,
  directionOverlap,
  distinctness,
  isNearDuplicate,
  soundsLikeFiller,
  usesJargon,
} from "@/lib/jobs/directions/text-overlap";
import type { DIRECTIONS_EVAL_THRESHOLDS, DirectionsEvalCase } from "./cases";

/**
 * Deterministic scoring for the directions eval. Two lanes, scored apart:
 *
 *  - **The model's own answer** (`drafts`, before the fit pass and before
 *    finalize.ts). Round 1 scored only what finalizeReasons selected, with
 *    the same grounding rule the selection used, so a pass was partly true
 *    by construction. These numbers say how good the model is unaided.
 *  - **What is delivered** (`directions`). The structural rules make most
 *    of these exact, so anything short of the threshold is a bug.
 *
 * Only the plate's content is asked of a model (run.mts); everything here
 * has one right answer given the output.
 */

export interface PlateResult {
  check: PlateCheck;
  imageCalls: number;
  /** The eval's own look at a plate that was delivered: does it show the
   *  product? Null when nothing was delivered or the look failed. */
  showsProduct: boolean | null;
  subject: string;
}

export interface DirectionsCaseScore {
  id: string;
  expected: number;
  delivered: number;
  /** After the forcing rule; on a regenerate, apart from both existing. */
  layoutsDiffer: boolean;
  modelLayoutsDiffer: boolean;
  /** Every delivered direction parses directionSpecSchema. */
  withinLimits: boolean;
  /** Model drafts with every field inside the contract, unaided. */
  modelDirections: number;
  modelDirectionsWithinLimits: number;
  /** The model's own reasons. */
  modelReasons: number;
  modelGrounded: number;
  modelSpatial: number;
  modelCutOff: number;
  /** The model's own copy fields and reasons that state a fact the brief
   *  does not hold. */
  modelFields: number;
  modelInvented: number;
  modelInventedExamples: string[];
  /** Delivered reasons. */
  reasons: number;
  grounded: number;
  filler: number;
  jargon: number;
  spatial: number;
  cutOff: number;
  /** Delivered reasons reasonHolds rejects against the delivered copy. */
  falseClaims: number;
  /** Delivered copy fields and reasons with an invented fact. */
  invented: number;
  inventedExamples: string[];
  firstNearDuplicate: boolean;
  finalNearDuplicate: boolean;
  distinctness: number;
  redrafted: boolean;
  modelCalls: number;
  fitAsked: number;
  fitFixed: number;
  /** For a case whose brief names a product: whether every delivered
   *  direction named it. */
  productNamed: boolean | null;
  plates: PlateResult[];
  titles: string[];
  headlines: string[];
  layouts: string[];
}

export function checksFor(testCase: DirectionsEvalCase): DirectionChecks {
  const brand = testCase.brand;
  return {
    ledger: factLedger([
      testCase.request.briefText,
      testCase.request.title,
      brand.name,
      brand.overview,
      brand.targetAudience,
      brand.tone,
      brand.offer,
    ]),
    briefText: testCase.request.briefText,
    title: testCase.request.title,
    audience: brand.targetAudience,
  };
}

function copyOf(d: DirectionDraft | DirectionSpec): DrawnCopy {
  return {
    headline: d.headline,
    subheadline: d.subheadline,
    cta: d.cta,
    footerLines: d.footerLines ?? [],
  };
}

function fieldsOf(d: DirectionDraft | DirectionSpec): string[] {
  return [d.headline, d.subheadline, d.cta, ...(d.footerLines ?? [])].filter(
    (t): t is string => Boolean(t?.trim()),
  );
}

function draftWithinLimits(draft: DirectionDraft): boolean {
  const fits = (text: string | undefined, max: number) =>
    !text || text.replace(/\s+/g, " ").trim().length <= max;
  return (
    fits(draft.title, COPY_LIMITS.title) &&
    fits(draft.headline, COPY_LIMITS.headline) &&
    fits(draft.subheadline, COPY_LIMITS.subheadline) &&
    fits(draft.cta, COPY_LIMITS.cta) &&
    (draft.footerLines ?? []).every((l) => fits(l, COPY_LIMITS.footerLine)) &&
    draft.rationale.length >= DIRECTION_REASONS_MIN &&
    draft.rationale.length <= DIRECTION_REASONS_MAX &&
    draft.rationale.every((r) => fits(r, COPY_LIMITS.reason))
  );
}

/** A delivered reason that is the model's own sentence with its end cut
 *  off, or that reads as unfinished. */
function isCutOff(reason: string, raw: string[]): boolean {
  if (looksCutOff(reason)) return true;
  return raw.some((r) => {
    const whole = r.replace(/\s+/g, " ").trim();
    if (whole === reason || !whole.startsWith(reason)) return false;
    /* Whole clauses kept (the rest started after a comma or full stop) are
       a shorter sentence, not a cut one. */
    return !/^[,;:.!?]|^\s[-–—]/.test(whole.slice(reason.length));
  });
}

export function scoreDirectionsCase(
  testCase: DirectionsEvalCase,
  result: {
    directions: DirectionSpec[];
    drafts: DirectionDraft[];
    redrafted: boolean;
    modelCalls: number;
    fit?: { asked: number; fixed: number };
  },
  plates: PlateResult[] = [],
): DirectionsCaseScore {
  const { directions, drafts } = result;
  const checks = checksFor(testCase);
  const existing = testCase.regenerate?.existing ?? [];
  const expected = existing.length > 0 ? 1 : 2;
  const product = testCase.product ?? "";
  const anchors = groundingAnchors({
    briefText: checks.briefText,
    title: checks.title,
    product,
    ledger: checks.ledger,
    audience: checks.audience,
  });
  const ignore = contentStems(testCase.brand.name);
  const options = {
    compareScenes: testCase.imageSource === "ko",
    ignore,
    briefWords: contentStems(
      `${testCase.request.briefText} ${testCase.request.title}`,
    ),
  };

  const modelReasons = drafts.flatMap((d) => d.rationale);
  const modelFields = drafts.flatMap(fieldsOf);
  const modelInvented = [...modelFields, ...modelReasons].flatMap((text) =>
    inventedFacts(text, checks.ledger),
  );

  const reasons = directions.flatMap((d) => d.rationale);
  const delivered = directions.flatMap((d) => [...fieldsOf(d), ...d.rationale]);
  const invented = delivered.flatMap((text) =>
    inventedFacts(text, checks.ledger),
  );
  const falseClaims = directions.flatMap((d) =>
    d.rationale.filter(
      (r) =>
        !reasonHolds(r, {
          copy: copyOf(d),
          ledger: checks.ledger,
          briefText: checks.briefText,
          product: d.productName,
          image: "pending",
          paintedScene:
            testCase.imageSource === "ko" ? d.backgroundPrompt : undefined,
        }).ok,
    ),
  );

  let finalOverlap: DirectionOverlap | null = null;
  let firstOverlap: DirectionOverlap | null = null;
  if (existing.length > 0) {
    const worst = (d: Parameters<typeof directionOverlap>[1] | undefined) =>
      d
        ? existing
            .map((e) => directionOverlap(e, d, options))
            .reduce((a, b) => (b.max > a.max ? b : a))
        : null;
    finalOverlap = worst(directions[0]);
    firstOverlap = worst(drafts[0]);
  } else {
    if (directions.length === 2) {
      finalOverlap = directionOverlap(directions[0], directions[1], options);
    }
    if (drafts.length === 2) {
      firstOverlap = directionOverlap(drafts[0], drafts[1], options);
    }
  }

  const takenByExisting = new Set(existing.map((e) => e.layout));
  const layoutsDiffer =
    existing.length > 0
      ? directions.length === 1 && !takenByExisting.has(directions[0].layout)
      : directions.length === 2 &&
        directions[0].layout !== directions[1].layout;
  const modelLayoutsDiffer =
    existing.length > 0
      ? drafts.length === 1 && !takenByExisting.has(drafts[0].layout)
      : drafts.length === 2 && drafts[0].layout !== drafts[1].layout;

  return {
    id: testCase.id,
    expected,
    delivered: directions.length,
    layoutsDiffer,
    modelLayoutsDiffer,
    withinLimits: directions.every(
      (d) => directionSpecSchema.safeParse(d).success,
    ),
    modelDirections: drafts.length,
    modelDirectionsWithinLimits: drafts.filter(draftWithinLimits).length,
    modelReasons: modelReasons.length,
    modelGrounded: modelReasons.filter((r) => isGrounded(r, anchors)).length,
    modelSpatial: modelReasons.filter((r) =>
      spatialClaim(r, checks.ledger.text),
    ).length,
    modelCutOff: modelReasons.filter((r) => looksCutOff(r)).length,
    modelFields: modelFields.length + modelReasons.length,
    modelInvented: [...modelFields, ...modelReasons].filter(
      (text) => inventedFacts(text, checks.ledger).length > 0,
    ).length,
    modelInventedExamples: modelInvented.slice(0, 6),
    reasons: reasons.length,
    grounded: reasons.filter((r) => isGrounded(r, anchors)).length,
    filler: reasons.filter(
      (r) => soundsLikeFiller(r) && !isGrounded(r, anchors),
    ).length,
    jargon: reasons.filter(usesJargon).length,
    spatial: reasons.filter((r) => spatialClaim(r, checks.ledger.text)).length,
    cutOff: reasons.filter((r) => isCutOff(r, modelReasons)).length,
    falseClaims: falseClaims.length,
    invented: delivered.filter(
      (text) => inventedFacts(text, checks.ledger).length > 0,
    ).length,
    inventedExamples: invented.slice(0, 6),
    firstNearDuplicate: firstOverlap ? isNearDuplicate(firstOverlap) : true,
    finalNearDuplicate: finalOverlap ? isNearDuplicate(finalOverlap) : true,
    distinctness: finalOverlap ? distinctness(finalOverlap) : 0,
    redrafted: result.redrafted,
    modelCalls: result.modelCalls,
    fitAsked: result.fit?.asked ?? 0,
    fitFixed: result.fit?.fixed ?? 0,
    productNamed: product
      ? directions.length > 0 && directions.every((d) => Boolean(d.productName))
      : null,
    plates,
    titles: directions.map((d) => d.title),
    headlines: directions.map((d) => d.headline),
    layouts: directions.map((d) => d.layout),
  };
}

export interface DirectionsTotals {
  cases: number;
  countRight: number;
  layoutsDiffer: number;
  modelLayoutsDiffer: number;
  withinLimits: number;
  modelWithinLimits: number;
  modelGroundedShare: number;
  modelSpatialShare: number;
  modelCutOffShare: number;
  modelInventedShare: number;
  groundedShare: number;
  fillerShare: number;
  jargon: number;
  spatial: number;
  cutOff: number;
  falseClaims: number;
  invented: number;
  meanDistinctness: number;
  minDistinctness: number;
  firstNearDuplicates: number;
  finalNearDuplicates: number;
  redrafts: number;
  modelCalls: number;
  fitAsked: number;
  fitFixed: number;
  productNamed: number;
  plates: number;
  /** Delivered plates the eval's own look says show the product, over
   *  every plate a product case asked for (a plate drawn flat counts as
   *  not showing it). */
  plateShowsProduct: number;
  /** Delivered plates that show something other than the product: the
   *  failure round 1 shipped. */
  wrongProductPlates: number;
  platesRetried: number;
  platesFlat: number;
  plateImageCalls: number;
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function share(values: boolean[]): number {
  return ratio(values.filter(Boolean).length, values.length);
}

const sum = (
  scores: DirectionsCaseScore[],
  pick: (s: DirectionsCaseScore) => number,
) => scores.reduce((n, s) => n + pick(s), 0);

export function aggregateDirections(
  scores: DirectionsCaseScore[],
): DirectionsTotals {
  const reasons = sum(scores, (s) => s.reasons);
  const modelReasons = sum(scores, (s) => s.modelReasons);
  const distinct = scores.map((s) => s.distinctness);
  const plates = scores.flatMap((s) => s.plates);
  const productCases = scores.filter((s) => s.productNamed !== null);
  return {
    cases: scores.length,
    countRight: share(scores.map((s) => s.delivered === s.expected)),
    layoutsDiffer: share(scores.map((s) => s.layoutsDiffer)),
    modelLayoutsDiffer: share(scores.map((s) => s.modelLayoutsDiffer)),
    withinLimits: share(scores.map((s) => s.withinLimits)),
    modelWithinLimits: ratio(
      sum(scores, (s) => s.modelDirectionsWithinLimits),
      sum(scores, (s) => s.modelDirections),
    ),
    modelGroundedShare: ratio(
      sum(scores, (s) => s.modelGrounded),
      modelReasons,
    ),
    modelSpatialShare: ratio(
      sum(scores, (s) => s.modelSpatial),
      modelReasons,
    ),
    modelCutOffShare: ratio(
      sum(scores, (s) => s.modelCutOff),
      modelReasons,
    ),
    modelInventedShare: ratio(
      sum(scores, (s) => s.modelInvented),
      sum(scores, (s) => s.modelFields),
    ),
    groundedShare: ratio(
      sum(scores, (s) => s.grounded),
      reasons,
    ),
    fillerShare: ratio(
      sum(scores, (s) => s.filler),
      reasons,
    ),
    jargon: sum(scores, (s) => s.jargon),
    spatial: sum(scores, (s) => s.spatial),
    cutOff: sum(scores, (s) => s.cutOff),
    falseClaims: sum(scores, (s) => s.falseClaims),
    invented: sum(scores, (s) => s.invented),
    meanDistinctness:
      distinct.length === 0
        ? 0
        : distinct.reduce((a, b) => a + b, 0) / distinct.length,
    minDistinctness: distinct.length === 0 ? 0 : Math.min(...distinct),
    firstNearDuplicates: scores.filter((s) => s.firstNearDuplicate).length,
    finalNearDuplicates: scores.filter((s) => s.finalNearDuplicate).length,
    redrafts: scores.filter((s) => s.redrafted).length,
    modelCalls: sum(scores, (s) => s.modelCalls),
    fitAsked: sum(scores, (s) => s.fitAsked),
    fitFixed: sum(scores, (s) => s.fitFixed),
    productNamed: share(productCases.map((s) => s.productNamed === true)),
    plates: plates.length,
    plateShowsProduct: share(plates.map((p) => p.showsProduct === true)),
    wrongProductPlates: plates.filter((p) => p.showsProduct === false).length,
    platesRetried: plates.filter((p) => p.imageCalls > 1).length,
    platesFlat: plates.filter((p) => p.check === "failed").length,
    plateImageCalls: plates.reduce((n, p) => n + p.imageCalls, 0),
  };
}

/** Each failed threshold, in words; empty is a pass. */
export function directionsFailures(
  totals: DirectionsTotals,
  t: typeof DIRECTIONS_EVAL_THRESHOLDS,
  expectedCases: number,
): string[] {
  const failures: string[] = [];
  const need = (ok: boolean, what: string) => {
    if (!ok) failures.push(what);
  };
  need(
    totals.cases === expectedCases,
    `cases ${totals.cases}/${expectedCases}`,
  );
  need(totals.countRight >= t.minCountRight, "direction count");
  need(totals.layoutsDiffer >= t.minLayoutsDiffer, "layouts differ");
  need(totals.withinLimits >= t.minWithinLimits, "within limits");
  need(
    totals.modelWithinLimits >= t.minModelWithinLimits,
    "model writes to length",
  );
  need(
    totals.modelGroundedShare >= t.minModelGroundedShare,
    "model reasons grounded",
  );
  need(
    totals.modelSpatialShare <= t.maxModelSpatialShare,
    "model spatial claims",
  );
  /* Reported, not gated (Oluwaseyi's ruling, round 6): every invention in
     the model's first draft is caught before delivery, and the delivered
     lane's invented gate stays at 0. */
  need(
    totals.modelCutOffShare <= t.maxModelCutOffShare,
    "model cut-off reasons",
  );
  need(
    totals.groundedShare >= t.minGroundedShare,
    "delivered reasons grounded",
  );
  need(totals.fillerShare <= t.maxFillerShare, "filler");
  need(totals.jargon <= t.maxJargon, "jargon");
  need(totals.spatial <= t.maxSpatial, "delivered spatial claims");
  need(totals.cutOff <= t.maxCutOff, "delivered cut-off reasons");
  need(totals.falseClaims <= t.maxFalseClaims, "delivered false claims");
  need(totals.invented <= t.maxInvented, "delivered invented facts");
  need(totals.meanDistinctness >= t.minMeanDistinctness, "distinctness");
  need(
    totals.finalNearDuplicates <= t.maxFinalNearDuplicates,
    "near-duplicates",
  );
  need(totals.productNamed >= t.minProductNamed, "product named");
  if (totals.plates > 0) {
    need(
      totals.plateShowsProduct >= t.minPlateShowsProduct,
      "plates show the product",
    );
    need(
      totals.wrongProductPlates <= t.maxWrongProductPlates,
      "wrong-product plates delivered",
    );
  }
  return failures;
}
