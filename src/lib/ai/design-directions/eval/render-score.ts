/**
 * The rendered lane of the directions eval (round 3): what a client sees on
 * the delivered PNG, measured on the document and judged by questions the
 * product itself never asks.
 *
 * Round 2's eval never rendered a design, so it could not see headlines on
 * the pastry, a cropped product, facts the brief gave and the design
 * dropped, gibberish lettering on a plate, or a blank photo accepted as a
 * hero. Each of those is a metric here. Two are measured twice on purpose:
 * copy over the subject (geometry from the document, and a look at the
 * pixels), and invented facts (a judge reading the copy against the brief,
 * not inventedFacts, which filtered it).
 */

export interface RenderedDirection {
  caseId: string;
  index: number;
  layout: string;
  /** Null when the direction failed: the job's message instead of a PNG. */
  failed: string | null;
  /** The subject box was known (vision box or a cut-out's alpha). */
  subjectKnown: boolean;
  /** Guarded elements over the whole subject, from measureSubject: never
   *  the head-and-shoulders box a fallback layout kept clear (round-3 code
   *  critic: measuring the face box read 0 by construction). */
  overlaps: number;
  /** Share of the subject inside its frame, and its longer edge over the
   *  canvas's shorter side. Null without a subject. */
  visibleShare: number | null;
  edgeShare: number | null;
  /** The eval's look at the PNG: does copy sit on the product or a face,
   *  and is the product cut by an edge. Null when the look failed. */
  lookTextOverSubject: boolean | null;
  lookSubjectCut: boolean | null;
  /** The brief's hard facts this direction states (factStated). */
  factsStated: number;
  factsTotal: number;
  /** The judge's reading of the copy against the brief. */
  judgeUnsupported: string[];
  judgeMissing: string[];
  /** The eval's own look at the plate for writing. Null off KO. */
  plateLettering: boolean | null;
  /** Craft faults measured on the delivered document (craft.ts): a
   *  headline under other copy, copy over copy, copy across a card edge. */
  craftHard?: string | null;
  craftSoft?: string | null;
  /** The rendered copy names the case's product. Null without one. */
  productNamed?: boolean | null;
  /** Placeholders ("[LINK]", "TBC") in the rendered copy. */
  placeholders?: string[];
  /** The gate's correction path, run for real on probe cases: the judge
   *  prescribes, the job's own rules accept or refuse, and what is
   *  delivered is measured. Null when not probed. */
  correction?: {
    /** The judge answered with a change. */
    prescribed: boolean;
    kept: boolean;
    /** Brief facts the delivered design lost against the first render. */
    lostFacts: number;
    /** Copy on the subject the layout kept clear, after the gate. */
    overSubject: boolean;
  } | null;
}

export interface RenderedCase {
  caseId: string;
  expectRefused: boolean;
  /** The loader's refusal, when it refused. */
  refused: string | null;
  directions: RenderedDirection[];
  /** Facts stated by at least one direction, over the brief's facts. */
  factsCoveredAnywhere: number;
  factsTotal: number;
}

export interface RenderTotals {
  cases: number;
  directions: number;
  failedDirections: number;
  subjectKnownShare: number;
  copyOverSubject: number;
  lookTextOverSubjectShare: number;
  croppedShare: number;
  lookCutShare: number;
  caseFactCoverage: number;
  directionFactCoverage: number;
  judgeInventedShare: number;
  judgeMissingShare: number;
  plates: number;
  letteredPlateShare: number;
  refusalsExpected: number;
  refusalsMade: number;
  unexpectedRefusals: number;
  craftHard: number;
  craftSoftShare: number;
  productNamedShare: number;
  placeholders: number;
  correctionsProbed: number;
  correctionsPrescribed: number;
  correctionsKept: number;
  correctionLostFacts: number;
  correctionOverSubject: number;
}

/** Frozen before the round-3 run. */
export const RENDER_THRESHOLDS = {
  /** Delivered directions with copy, a button, the rule or the logo on the
   *  known subject. The job re-lays-out or fails these, so any is a bug. */
  maxCopyOverSubject: 0,
  /** The same question asked of the pixels. The look is a model, so a
   *  margin for its own errors. */
  maxLookTextOverSubjectShare: 0.15,
  /** Delivered directions whose subject is cut by its frame or drawn under
   *  35% of the shorter side (SUBJECT_CROPPED is a reported fault, not a
   *  failure). */
  maxCroppedShare: 0.25,
  /** Every fact the brief gives is on at least one direction. */
  minCaseFactCoverage: 1,
  /** Facts per direction: each design can be acted on alone. */
  minDirectionFactCoverage: 0.9,
  /** Directions where the judge found a statement the brief does not
   *  support. */
  maxJudgeInventedShare: 0.15,
  /** Delivered plates the eval's own look finds writing on. */
  maxLetteredPlateShare: 0.1,
  /** Round 4, frozen before its run. Directions where the judge says a
   *  hard fact of the brief is missing; it also lists soft details, so a
   *  margin for that, as for invented. */
  maxJudgeMissingShare: 0.15,
  /** A delivered headline under other copy, copy over copy, or copy across
   *  a card edge. The job refuses these layouts, so any is a bug. */
  maxCraftHard: 0,
  /** Product cases whose rendered copy names the product, per direction. */
  minProductNamedShare: 1,
  maxPlaceholders: 0,
  /** At least one correction path actually exercised per run, and none of
   *  them losing a fact or laying copy on the subject. */
  minCorrectionsProbed: 1,
  maxCorrectionLostFacts: 0,
  maxCorrectionOverSubject: 0,
  /** Bad photos refused, of those that must be. */
  minRefusals: 1,
  maxUnexpectedRefusals: 0,
} as const;

const share = (n: number, d: number) => (d === 0 ? 0 : n / d);

export function isCropped(d: RenderedDirection): boolean {
  if (!d.subjectKnown || d.visibleShare === null || d.edgeShare === null) {
    return false;
  }
  return d.visibleShare < 0.995 || d.edgeShare < 0.345;
}

export function aggregateRender(cases: RenderedCase[]): RenderTotals {
  const all = cases.flatMap((c) => c.directions);
  const delivered = all.filter((d) => d.failed === null);
  const known = delivered.filter((d) => d.subjectKnown);
  const looked = delivered.filter((d) => d.lookTextOverSubject !== null);
  const cut = delivered.filter((d) => d.lookSubjectCut !== null);
  const plates = delivered.filter((d) => d.plateLettering !== null);
  const factCases = cases.filter((c) => c.factsTotal > 0 && !c.refused);
  const factDirections = delivered.filter((d) => d.factsTotal > 0);
  const productDirections = delivered.filter((d) => d.productNamed != null);
  return {
    cases: cases.length,
    directions: all.length,
    failedDirections: all.length - delivered.length,
    subjectKnownShare: share(known.length, delivered.length),
    copyOverSubject: known.filter((d) => d.overlaps > 0).length,
    lookTextOverSubjectShare: share(
      looked.filter((d) => d.lookTextOverSubject).length,
      looked.length,
    ),
    croppedShare: share(known.filter(isCropped).length, known.length),
    lookCutShare: share(cut.filter((d) => d.lookSubjectCut).length, cut.length),
    caseFactCoverage:
      factCases.length === 0
        ? 1
        : factCases.reduce(
            (sum, c) => sum + c.factsCoveredAnywhere / c.factsTotal,
            0,
          ) / factCases.length,
    directionFactCoverage:
      factDirections.length === 0
        ? 1
        : factDirections.reduce(
            (sum, d) => sum + d.factsStated / d.factsTotal,
            0,
          ) / factDirections.length,
    judgeInventedShare: share(
      delivered.filter((d) => d.judgeUnsupported.length > 0).length,
      delivered.length,
    ),
    judgeMissingShare: share(
      delivered.filter((d) => d.judgeMissing.length > 0).length,
      delivered.length,
    ),
    plates: plates.length,
    letteredPlateShare: share(
      plates.filter((d) => d.plateLettering).length,
      plates.length,
    ),
    craftHard: delivered.filter((d) => d.craftHard).length,
    craftSoftShare: share(
      delivered.filter((d) => d.craftSoft).length,
      delivered.length,
    ),
    productNamedShare:
      productDirections.length === 0
        ? 1
        : share(
            productDirections.filter((d) => d.productNamed).length,
            productDirections.length,
          ),
    placeholders: delivered.reduce(
      (n, d) => n + (d.placeholders?.length ?? 0),
      0,
    ),
    correctionsProbed: delivered.filter((d) => d.correction).length,
    correctionsPrescribed: delivered.filter((d) => d.correction?.prescribed)
      .length,
    correctionsKept: delivered.filter((d) => d.correction?.kept).length,
    correctionLostFacts: delivered.reduce(
      (n, d) => n + (d.correction?.lostFacts ?? 0),
      0,
    ),
    correctionOverSubject: delivered.filter((d) => d.correction?.overSubject)
      .length,
    refusalsExpected: cases.filter((c) => c.expectRefused).length,
    refusalsMade: cases.filter((c) => c.expectRefused && c.refused).length,
    unexpectedRefusals: cases.filter((c) => !c.expectRefused && c.refused)
      .length,
  };
}

export function renderFailures(
  t: RenderTotals,
  limits: typeof RENDER_THRESHOLDS = RENDER_THRESHOLDS,
): string[] {
  const failures: string[] = [];
  const over = (name: string, value: number, max: number) => {
    if (value > max) failures.push(`${name} ${value.toFixed(2)} > ${max}`);
  };
  const under = (name: string, value: number, min: number) => {
    if (value < min) failures.push(`${name} ${value.toFixed(2)} < ${min}`);
  };
  over("copy over subject", t.copyOverSubject, limits.maxCopyOverSubject);
  over(
    "look: text over subject",
    t.lookTextOverSubjectShare,
    limits.maxLookTextOverSubjectShare,
  );
  over("cropped subject", t.croppedShare, limits.maxCroppedShare);
  under(
    "brief facts on any direction",
    t.caseFactCoverage,
    limits.minCaseFactCoverage,
  );
  under(
    "brief facts per direction",
    t.directionFactCoverage,
    limits.minDirectionFactCoverage,
  );
  over("judge: invented", t.judgeInventedShare, limits.maxJudgeInventedShare);
  over("lettered plates", t.letteredPlateShare, limits.maxLetteredPlateShare);
  over("judge: missing", t.judgeMissingShare, limits.maxJudgeMissingShare);
  over("craft faults delivered", t.craftHard, limits.maxCraftHard);
  under(
    "rendered copy names the product",
    t.productNamedShare,
    limits.minProductNamedShare,
  );
  over("placeholders", t.placeholders, limits.maxPlaceholders);
  under(
    "correction paths probed",
    t.correctionsProbed,
    limits.minCorrectionsProbed,
  );
  over(
    "correction lost facts",
    t.correctionLostFacts,
    limits.maxCorrectionLostFacts,
  );
  over(
    "correction put copy on the subject",
    t.correctionOverSubject,
    limits.maxCorrectionOverSubject,
  );
  if (t.refusalsExpected > 0) {
    under(
      "bad photos refused",
      share(t.refusalsMade, t.refusalsExpected),
      limits.minRefusals,
    );
  }
  over(
    "unexpected refusals",
    t.unexpectedRefusals,
    limits.maxUnexpectedRefusals,
  );
  return failures;
}
