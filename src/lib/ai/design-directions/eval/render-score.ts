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

import type { DesignElement } from "@/lib/design/document/schema";
import {
  aboveRepeats,
  type BriefFact,
  factStated,
  isFragment,
  isProductName,
  numbersIn,
  redundantFooterItems,
} from "@/lib/jobs/directions/brief-facts";
import { isAction } from "@/lib/jobs/directions/finalize";

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
    /** Copy on the whole subject after the gate, whatever box the layout
     *  kept clear (round-4 code critic: measured on the face box it read
     *  0 by construction). */
    overSubject: boolean;
  } | null;
  /** Round 5: corrections that change the copy, through the job's own
   *  gate rules (directionGateRules): one that drops the footer's facts and
   *  one that invents a fact must be refused; one that sets the headline
   *  to the brief's title must be kept exactly when it loses no fact
   *  (rewriteKept: the rules decided it right), and a kept render must
   *  keep copy off the whole subject. Null when not probed. */
  copyProbe?: {
    lossRefused: boolean;
    inventionRefused: boolean;
    rewriteKept: boolean;
    rewriteOverSubject: boolean;
  } | null;
  /** Round 5 craft, measured on the delivered document (craftOfDelivered). */
  craft5?: DeliveredCraft;
  /** Round 7: at least two of the judge's three readings came back. A
   *  direction with fewer is unjudged, not clean, and is left out of every
   *  judged share. Undefined on records from before round 7. */
  judged?: boolean;
  /** Layouts the chooser judged that showed the whole subject uncut, with
   *  no hard fault and the picture off its card's edge. */
  cleanLayouts?: string[];
  /** A KO direction drawn with no image because no plate passed. Null off
   *  KO. */
  textLed?: boolean | null;
  /** Round 6: the job refused this direction for a subject fault (cut, or
   *  copy on it), as it does in production. */
  subjectRefused?: boolean;
  /** Round 6: every real person the case names is named in the drawn copy.
   *  Null when the case names nobody. */
  peopleNamed?: boolean | null;
  /** Round 6: the eval's own look at the plate saw a person beside a case
   *  that names a real one. Null off KO or when nobody is named. */
  personPainted?: boolean | null;
  /** Round 6: the judge's reading of footer text that only repeats what
   *  the copy already says, and of lines cut mid-phrase. Independent of
   *  redundantFooterItems, which the job itself uses to remove repeats. */
  judgeRepeated?: string[];
  judgeFragments?: string[];
}

export interface DeliveredCraft {
  /** An accent panel where the picture would be, with no picture. */
  emptyImageRegion: boolean;
  /** Footer items that repeat the copy above or each other. */
  footerRepeats: string[];
  /** A footer item that is only the product's name. */
  productInFooter: boolean;
  /** A picture drawn over its card's border. */
  imageOverFrame: boolean;
  /** Round 6: a picture narrower than its card, against the card's edge. */
  imageAgainstFrame?: boolean;
  /** Round 6: footer items that end mid-phrase ("fees for your"). */
  fragments?: string[];
  /** Round 8: what the subheadline says again from the headline or the
   *  button (aboveRepeats). */
  aboveRepeats?: string[];
  /** Round 7: a button that is not an action ("First session free"). */
  buttonNotAction?: boolean;
  /** Round 6: price labels drawn in the footer as a bare number, without
   *  the unit the brief gives (and not given above the footer). */
  pricesDetached?: string[];
}

/**
 * The round-4 live critic's craft defects, read off a delivered document:
 * an empty image half, a footer repeating the subheadline or the address,
 * the product's name dumped into the footer, and a photo over the stat
 * card's border. Each was invisible to every metric the eval had.
 */
export function craftOfDelivered(
  elements: readonly DesignElement[],
  copy: {
    headline: string;
    subheadline?: string;
    cta?: string;
    footerLines: string[];
  },
  product: string,
  prices: readonly BriefFact[] = [],
): DeliveredCraft {
  const image = elements.findIndex((e) => e.type === "image");
  const footerItems = copy.footerLines.flatMap((line) =>
    line.split(" · ").map((item) => item.trim()),
  );
  const card = elements.find(
    (e) => e.type === "shape" && e.id === "card" && (e.borderWidth ?? 0) > 0,
  );
  const edgeAfterImage = elements.some(
    (e, i) => i > image && e.id === "card-edge",
  );
  const picture = image >= 0 ? elements[image] : null;
  const border = card && card.type === "shape" ? (card.borderWidth ?? 0) : 0;
  const imageOverFrame = Boolean(
    card &&
      picture &&
      !edgeAfterImage &&
      (picture.x < card.x + border ||
        picture.y < card.y + border ||
        picture.x + picture.width > card.x + card.width - border ||
        picture.y + picture.height > card.y + card.height - border),
  );
  const anyCard = elements.find(
    (e) => e.type === "shape" && (e.id === "card" || e.id === "card-edge"),
  );
  const imageAgainstFrame = Boolean(
    anyCard &&
      picture &&
      picture.width < anyCard.width - 1 &&
      Math.abs(picture.y - anyCard.y) <= 1,
  );
  /* Round 7: a bare count ("Two") or price is a fragment too (round-6
     live critic: the gate passed "Two" on both recruitment directions). */
  const fragments = footerItems.filter((item) => item && isFragment(item));
  const pricesDetached = prices
    .filter((fact) => fact.kind === "price")
    .filter((fact) => {
      /* The amount in a footer item while the price, unit and all, is
         stated nowhere. Read by value, not through factStated: a fact with
         no words of its own was never stated, so this check could not
         fire (found rebuilding the verifier, round 11). */
      const numbers = fact.needs
        .filter((n) => n.startsWith("="))
        .map((n) => n.slice(1));
      if (numbers.length === 0) return false;
      return (
        footerItems.some((item) => {
          const shown = numbersIn(item);
          return numbers.every((n) => shown.has(n));
        }) && !factStated(fact, copy)
      );
    })
    .map((fact) => fact.text);
  return {
    imageAgainstFrame,
    buttonNotAction: Boolean(copy.cta?.trim()) && !isAction(copy.cta ?? ""),
    aboveRepeats: aboveRepeats(copy),
    fragments,
    pricesDetached,
    emptyImageRegion:
      image < 0 && elements.some((e) => e.id === "accent-panel"),
    footerRepeats: redundantFooterItems(copy),
    productInFooter: footerItems.some((item) => isProductName(item, product)),
    imageOverFrame,
  };
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
  /** Delivered directions the judge could not read twice. */
  unjudged: number;
  /** Delivered buttons that are not an action. */
  buttonsNotActions: number;
  /** Delivered directions whose subheadline repeats the headline or the
   *  button. */
  aboveRepeats: number;
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
  copyProbes: number;
  copyProbeFailures: number;
  copyProbeOverSubject: number;
  emptyImageRegions: number;
  footerRepeats: number;
  productInFooter: number;
  imageOverFrame: number;
  /** KO directions drawn with no image, and how many KO directions. */
  textLed: number;
  koDirections: number;
  textLedShare: number;
  /** Round 6. */
  subjectRefused: number;
  deliveredSubjectCut: number;
  peopleNamedShare: number;
  personPainted: number;
  judgeRepeatedShare: number;
  fragments: number;
  pricesDetached: number;
  imageAgainstFrame: number;
  /** Of those, delivered while a clean layout was there to take. */
  imageAgainstFrameAvoidable: number;
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
  /** Round 5, frozen before its run. The job builds none of these, so any
   *  is a bug: an empty image half, a footer repeating other copy, the
   *  product's name as a footer item, a picture over its frame. */
  maxEmptyImageRegions: 0,
  maxFooterRepeats: 0,
  maxProductInFooter: 0,
  maxImageOverFrame: 0,
  /** Copy-changing corrections probed, and none of the gate's rules
   *  failing on them. */
  minCopyProbes: 1,
  maxCopyProbeFailures: 0,
  maxCopyProbeOverSubject: 0,
  /** Round 6, frozen before its run (round-5 live critic's "what would
   *  flip this"). A delivered subject cut by its frame: the job refuses
   *  these, so any is a bug. */
  maxDeliveredSubjectCut: 0,
  /** KO directions laid out as text because no plate passed: paid image
   *  calls that bought no image. */
  maxTextLedShare: 0.25,
  /** Directions naming every real person the brief names. */
  minPeopleNamedShare: 1,
  /** Plates showing any person beside a brief that names a real one. */
  maxPersonPainted: 0,
  /** Directions where the judge reads a footer repeat. A model's reading,
   *  so a margin for its own errors. */
  maxJudgeRepeatedShare: 0.15,
  /** Footer items ending mid-phrase and prices drawn without their unit:
   *  the job builds none of these. */
  maxFragments: 0,
  maxPricesDetached: 0,
  /** A photo flush against its card's edge is delivered, with its fault,
   *  when every layout would crop or cover the product (Oluwaseyi's
   *  ruling, round 6); only one delivered while a clean layout existed is
   *  a failure. The rest are reported. */
  maxImageAgainstFrameAvoidable: 0,
  /** Round 7: every requested direction is delivered (Oluwaseyi's ruling:
   *  a photo that fits one layout leaves the sibling text-led, never
   *  undelivered), every button is an action, and at most one in ten
   *  directions goes unjudged; an unjudged direction is never counted
   *  clean. */
  maxFailedDirections: 0,
  maxButtonsNotActions: 0,
  /** Round 8: every fact once, above the footer as in it. */
  maxAboveRepeats: 0,
  maxUnjudgedShare: 0.1,
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
  const judged = delivered.filter((d) => d.judged !== false);
  return {
    cases: cases.length,
    directions: all.length,
    failedDirections: all.length - delivered.length,
    unjudged: delivered.length - judged.length,
    buttonsNotActions: delivered.filter((d) => d.craft5?.buttonNotAction)
      .length,
    aboveRepeats: delivered.filter(
      (d) => (d.craft5?.aboveRepeats?.length ?? 0) > 0,
    ).length,
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
      judged.filter((d) => d.judgeUnsupported.length > 0).length,
      judged.length,
    ),
    judgeMissingShare: share(
      judged.filter((d) => d.judgeMissing.length > 0).length,
      judged.length,
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
    copyProbes: delivered.filter((d) => d.copyProbe).length,
    copyProbeFailures: delivered.filter(
      (d) =>
        d.copyProbe &&
        !(
          d.copyProbe.lossRefused &&
          d.copyProbe.inventionRefused &&
          d.copyProbe.rewriteKept
        ),
    ).length,
    copyProbeOverSubject: delivered.filter(
      (d) => d.copyProbe?.rewriteOverSubject,
    ).length,
    emptyImageRegions: delivered.filter((d) => d.craft5?.emptyImageRegion)
      .length,
    footerRepeats: delivered.filter(
      (d) => (d.craft5?.footerRepeats.length ?? 0) > 0,
    ).length,
    productInFooter: delivered.filter((d) => d.craft5?.productInFooter).length,
    imageOverFrame: delivered.filter((d) => d.craft5?.imageOverFrame).length,
    textLed: delivered.filter((d) => d.textLed).length,
    koDirections: delivered.filter(
      (d) => d.textLed !== null && d.textLed !== undefined,
    ).length,
    textLedShare: share(
      delivered.filter((d) => d.textLed).length,
      delivered.filter((d) => d.textLed !== null && d.textLed !== undefined)
        .length,
    ),
    subjectRefused: all.filter((d) => d.subjectRefused).length,
    deliveredSubjectCut: known.filter(
      (d) => d.visibleShare !== null && d.visibleShare < 0.995,
    ).length,
    peopleNamedShare: (() => {
      const named = delivered.filter((d) => d.peopleNamed != null);
      return named.length === 0
        ? 1
        : share(named.filter((d) => d.peopleNamed).length, named.length);
    })(),
    personPainted: delivered.filter((d) => d.personPainted).length,
    judgeRepeatedShare: share(
      judged.filter((d) => (d.judgeRepeated?.length ?? 0) > 0).length,
      judged.length,
    ),
    fragments: delivered.filter((d) => (d.craft5?.fragments?.length ?? 0) > 0)
      .length,
    pricesDetached: delivered.filter(
      (d) => (d.craft5?.pricesDetached?.length ?? 0) > 0,
    ).length,
    imageAgainstFrame: delivered.filter((d) => d.craft5?.imageAgainstFrame)
      .length,
    imageAgainstFrameAvoidable: delivered.filter(
      (d) => d.craft5?.imageAgainstFrame && (d.cleanLayouts?.length ?? 0) > 0,
    ).length,
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
  over("empty image regions", t.emptyImageRegions, limits.maxEmptyImageRegions);
  over("footer repeats", t.footerRepeats, limits.maxFooterRepeats);
  over("product name in footer", t.productInFooter, limits.maxProductInFooter);
  over("picture over its frame", t.imageOverFrame, limits.maxImageOverFrame);
  under("copy corrections probed", t.copyProbes, limits.minCopyProbes);
  over(
    "copy corrections the rules got wrong",
    t.copyProbeFailures,
    limits.maxCopyProbeFailures,
  );
  over(
    "copy correction put copy on the subject",
    t.copyProbeOverSubject,
    limits.maxCopyProbeOverSubject,
  );
  over(
    "delivered subject cut by its frame",
    t.deliveredSubjectCut,
    limits.maxDeliveredSubjectCut,
  );
  over("KO laid out as text", t.textLedShare, limits.maxTextLedShare);
  under(
    "named people on every direction",
    t.peopleNamedShare,
    limits.minPeopleNamedShare,
  );
  over(
    "person painted beside a named one",
    t.personPainted,
    limits.maxPersonPainted,
  );
  over(
    "judge: footer repeats",
    t.judgeRepeatedShare,
    limits.maxJudgeRepeatedShare,
  );
  over("fact fragments", t.fragments, limits.maxFragments);
  over("prices without their unit", t.pricesDetached, limits.maxPricesDetached);
  over(
    "directions not delivered",
    t.failedDirections,
    limits.maxFailedDirections,
  );
  over(
    "buttons that are not actions",
    t.buttonsNotActions,
    limits.maxButtonsNotActions,
  );
  over(
    "subheadline repeats the headline or button",
    t.aboveRepeats,
    limits.maxAboveRepeats,
  );
  over(
    "unjudged directions",
    share(t.unjudged, t.directions - t.failedDirections),
    limits.maxUnjudgedShare,
  );
  over(
    "picture against its card's edge with a clean layout to take",
    t.imageAgainstFrameAvoidable,
    limits.maxImageAgainstFrameAvoidable,
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

/** One reading of a direction's copy by the eval's judge. */
export interface JudgeReading {
  unsupported: string[];
  missing: string[];
  repeated: string[];
  fragments: string[];
}

const JUDGED = ["unsupported", "missing", "repeated", "fragments"] as const;

/**
 * Three readings of one direction, made one stable reading: a category
 * counts as flagged only when at least two readings flag it, and its
 * entries are those of the first reading that does. Round 6: on the same
 * delivery rules the judge's invented share read 0.03 to 0.21 across six
 * runs; a single sample decided a gate. A reading that failed is no vote;
 * with fewer than two readings the direction is unjudged (round-6 code
 * critic: it was counted clean, so a judge outage passed every gate).
 */
export function majorityJudge(
  readings: readonly (JudgeReading | null)[],
): JudgeReading & { judged: boolean } {
  const got = readings.filter((r): r is JudgeReading => r !== null);
  const out: JudgeReading = {
    unsupported: [],
    missing: [],
    repeated: [],
    fragments: [],
  };
  for (const key of JUDGED) {
    const flagging = got.filter((r) => (r[key] ?? []).length > 0);
    if (flagging.length >= 2) out[key] = flagging[0][key];
  }
  return { ...out, judged: got.length >= 2 };
}
