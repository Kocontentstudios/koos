import { generateObject } from "ai";
import { z } from "zod";
import {
  buildDirectionsPrompt,
  buildDirectionsSystemPrompt,
  buildFitPrompt,
  buildRedraftPrompt,
  type DirectionsImageSource,
  type ExistingDirection,
  type FitRequest,
} from "@/lib/ai/prompts/design-directions";
import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import { getModel } from "@/lib/ai/provider";
import type { DesignContext } from "@/lib/design/context";
import {
  aboveRepeatsBy,
  type BriefFact,
  brandRegion,
  dropFooterRepeats,
  type FactCoverage,
  factStated,
  withoutRepeatingSubheadline,
  withVenueOrBrand,
} from "./brief-facts";
import {
  type BriefRead,
  type BriefReader,
  coverFactsOf,
  NOT_AN_OFFERING,
  readBriefWithModel,
  settleBriefRead,
} from "./brief-read";
import {
  type ClaimChecker,
  type ClaimCheckField,
  checkClaims,
} from "./claim-check";
import {
  factLedger,
  inventedFacts,
  looksCutOff,
  resolveBriefProducts,
  spatialClaim,
} from "./claims";
import type { ConceptLens } from "./concepts";
import { type FactWriter, settleFacts, writeFacts } from "./fact-writer";
import {
  copyFault,
  correctionCheck,
  type DirectionChecks,
  type FinalizeReport,
  finalizeDirection,
  isAction,
  settleReasons,
} from "./finalize";
import {
  askFooterRewrites,
  checkFooterRepeats,
  dropButtonEchoes,
  type FooterRepeatChecker,
  type FooterRepeatOutcome,
  type FooterRewriter,
  hasSubheadlineRewrite,
  marksNeedingRewrite,
  readsAsList,
  settleMarkedRepeats,
} from "./footer-repeats";
import {
  type HeadlineRecoverer,
  type HeadlineRewriter,
  REWRITTEN_HEADLINE_MAX,
  recoverHeadline,
  rewriteHeadline,
} from "./headline-rewrite";
import { forceDistinctLayouts } from "./layouts";
import { repairDirectionsFor, repairFitText } from "./repair";
import {
  COPY_LIMITS,
  type DirectionDraft,
  type DirectionSpec,
  DRAFT_LIMITS,
  directionsResponseSchema,
} from "./schema";
import {
  type ComparableDirection,
  contentStems,
  type DirectionOverlap,
  directionOverlap,
  distinctiveWords,
  isNearDuplicate,
  isNearDuplicateHeadline,
} from "./text-overlap";

/** Two full specs plus their rationale. The single-spec cap (4000) was set
 *  because Bedrock's default truncated one spec mid-JSON. */
const DIRECTIONS_MAX_OUTPUT_TOKENS = 8000;

/* Bedrock's per-image ceiling for Claude is 3.75 MB. A larger upload is still
   used in the design; the art director just writes without seeing it. */
export const ART_DIRECTOR_IMAGE_MAX_BYTES = 3_500_000;

export interface PriorDirection
  extends ExistingDirection,
    ComparableDirection {}

export interface DraftDirectionsInput {
  context: DesignContext;
  imageSource: DirectionsImageSource;
  /** The uploaded photograph, shown to the art director when it fits. */
  image: { bytes: Uint8Array; contentType: string } | null;
  /** One lens per direction to write. */
  lenses: ConceptLens[];
  recentLayouts: string[];
  memorySummary?: string;
  /** Directions that already exist (regenerating one of a pair). */
  existing?: PriorDirection[];
  /** Reads the copy and reasons against the brief (claim-check.ts). */
  claimChecker?: ClaimChecker;
  /** Reads the brief's facts, offering and people (brief-read.ts). */
  briefReader?: BriefReader;
  /** Marks footer items repeating the copy above (footer-repeats.ts). */
  footerRepeatChecker?: FooterRepeatChecker;
  /** Writes a rewrite for marked items the first answer left without one. */
  footerRewriter?: FooterRewriter;
  /** New headlines on another idea, for a pair nothing on the page can
   *  separate (headline-rewrite.ts). */
  headlineRewriter?: HeadlineRewriter;
  /** One more headline for a direction whose headline was refused, before
   *  it is declared lost (headline-rewrite.ts). */
  headlineRecoverer?: HeadlineRecoverer;
  /** Writes what a direction leaves out into its copy (fact-writer.ts). */
  factWriter?: FactWriter;
}

/** What the claim check found and what became of it. */
export interface ClaimCheckOutcome {
  /** False when the check could not be reached. */
  available: boolean;
  flagged: number;
  /** Flagged fields replaced by a rewrite that passed every check. */
  rewritten: number;
  /** Flagged fields left off (or a headline set to the brief's title). */
  dropped: number;
  statements: string[];
  /** Headlines it flagged whose rewrite could not stand, and why. */
  headlineRefusals: HeadlineRefusal[];
}

export interface DraftDirectionsResult {
  directions: DirectionSpec[];
  /** What the model returned before the fit pass and finalising, for the
   *  eval: the model's own work, not what the rules made of it. */
  drafts: DirectionDraft[];
  /** Per delivered direction: copy that fell back and reasons left off. */
  reports: FinalizeReport[];
  /** The fit pass: fields the model was asked to rewrite, and how many of
   *  its rewrites passed. */
  fit: { asked: number; fixed: number };
  /** The checks the directions were held to, for the job's second pass over
   *  the reasons once the design is drawn. */
  checks: DirectionChecks;
  /** The art director saw the uploaded photograph when writing. */
  imageSeen: boolean;
  /** Directions whose layout the forcing rule changed. */
  layoutsForced: number;
  /** A pair nothing on the page could separate got a new headline. */
  headlineRewritten: boolean;
  /** Per direction: its headline could not be drawn as the model wrote it,
   *  so it fails rather than ship one code wrote. */
  headlineLost: boolean[];
  /** Directions whose headline was refused and asked for once more. */
  headlineRecovery: HeadlineRecovery[];
  /** A near-duplicate was found and one direction was written again. */
  redrafted: boolean;
  /** The closest pair after any redraft, new against new and new against
   *  existing. Null when there is nothing to compare. */
  overlap: DirectionOverlap | null;
  modelCalls: number;
  /** Where each direction's product name came from: the brief reader's
   *  phrase, the model's own words, its sibling's, the brief's, or none. */
  productSources: ("read" | "model" | "sibling" | "brief" | "none")[];
  /** The brief as read: its facts, what it offers, the people it names. */
  read: BriefRead;
  /** Every fact a direction must state: the brief's facts and the people
   *  it names. */
  coverFacts: BriefFact[];
  /** The brief's hard facts and which direction states each. */
  factCoverage: FactCoverage;
  claimCheck: ClaimCheckOutcome;
  /** Footer items a model marked as repeating the copy above in other
   *  words, and whether code dropped each. */
  footerRepeats: { available: boolean; outcomes: FooterRepeatOutcome[] };
}

/** The fit pass's answer: the rewritten text for each field it was asked
 *  about. */
const fitResponseSchema = z.object({
  fixes: z.array(z.object({ id: z.string(), text: z.string().max(400) })),
});

/** Why a reason cannot be shown as the model wrote it, or none. */
export function reasonProblems(
  reason: string,
  checks: DirectionChecks,
): string[] {
  const problems: string[] = [];
  const text = reason.replace(/\s+/g, " ").trim();
  if (text.length > COPY_LIMITS.reason) {
    problems.push(`${text.length} characters, limit ${COPY_LIMITS.reason}`);
  }
  const invented = inventedFacts(text, checks.ledger);
  if (invented.length > 0) {
    problems.push(`states ${invented.join(", ")}, which the brief does not`);
  }
  const spatial = spatialClaim(text, checks.ledger.text);
  if (spatial) {
    problems.push(
      `says "${spatial}", a position, size or light it cannot know`,
    );
  }
  if (looksCutOff(text)) problems.push("reads as an unfinished sentence");
  return problems;
}

/** Every field of `drafts` that cannot be drawn or shown as written. */
export function fitRequests(
  drafts: DirectionDraft[],
  checks: DirectionChecks,
  offering = "",
): FitRequest[] {
  const requests: FitRequest[] = [];
  const copy = (
    id: string,
    field: string,
    text: string | undefined,
    max: number,
  ) => {
    if (!text?.trim()) return;
    const fault = copyFault(text, max, checks.ledger);
    if (fault)
      requests.push({ id, field, text, limit: max, problems: [fault] });
  };
  drafts.forEach((draft, i) => {
    if (draft.title.trim().length > COPY_LIMITS.title) {
      requests.push({
        id: `${i}.title`,
        field: "direction title",
        text: draft.title,
        limit: COPY_LIMITS.title,
        problems: [`${draft.title.trim().length} characters`],
      });
    }
    copy(`${i}.headline`, "headline", draft.headline, COPY_LIMITS.headline);
    copy(
      `${i}.subheadline`,
      "subheadline",
      draft.subheadline,
      COPY_LIMITS.subheadline,
    );
    copy(`${i}.cta`, "button", draft.cta, COPY_LIMITS.cta);
    if (draft.cta?.trim() && !isAction(draft.cta)) {
      const problem =
        'a button is an action the customer takes, starting with a verb ("Book a free session"), not what they get';
      const asked = requests.find((r) => r.id === `${i}.cta`);
      if (asked) asked.problems.push(problem);
      else {
        requests.push({
          id: `${i}.cta`,
          field: "button",
          text: draft.cta,
          limit: COPY_LIMITS.cta,
          problems: [problem],
        });
      }
    }
    for (const [j, line] of (draft.footerLines ?? []).entries()) {
      copy(
        `${i}.footerLines.${j}`,
        "footer line",
        line,
        COPY_LIMITS.footerLine,
      );
    }
    /* A direction that never says what it sells cannot be acted on, and
       the product in the footer read as a dump (round-4 live critic); the
       subheadline is asked to name it instead. */
    if (offering && !namesOffering(draft, offering)) {
      const field = draft.subheadline?.trim() ? "subheadline" : "headline";
      const id = `${i}.${field}`;
      const text =
        (field === "subheadline" ? draft.subheadline : draft.headline) ?? "";
      const problem = `does not name what the brief promotes; name it as "${offering}"`;
      const asked = requests.find((r) => r.id === id);
      if (asked) asked.problems.push(problem);
      else {
        requests.push({
          id,
          field,
          text,
          limit: COPY_LIMITS[field],
          problems: [problem],
        });
      }
    }
    draft.rationale.forEach((reason, j) => {
      const problems = reasonProblems(reason, checks);
      if (problems.length > 0) {
        requests.push({
          id: `${i}.rationale.${j}`,
          field: "reason",
          text: reason,
          limit: COPY_LIMITS.reason,
          problems,
        });
      }
    });
  });
  return requests;
}

/** Whether a draft's headline, subheadline or button carries every word of
 *  the brief's name for what it promotes. */
export function namesOffering(
  draft: Pick<DirectionDraft, "headline" | "subheadline" | "cta">,
  offering: string,
): boolean {
  const wanted = contentStems(offering);
  const said = contentStems(
    [draft.headline, draft.subheadline, draft.cta].filter(Boolean).join(" "),
  );
  return [...wanted].every((stem) => said.has(stem));
}

/** The drafts with every rewrite that fixed its field applied. A rewrite
 *  that is itself over the limit, invents a fact, or still does not name
 *  what it was asked to is ignored. */
export function applyFits(
  drafts: DirectionDraft[],
  requests: FitRequest[],
  fixes: { id: string; text: string }[],
  checks: DirectionChecks,
  offering = "",
): { drafts: DirectionDraft[]; fixed: number } {
  const asked = new Map(requests.map((r) => [r.id, r]));
  const out = drafts.map((d) => ({
    ...d,
    footerLines: [...(d.footerLines ?? [])],
    rationale: [...d.rationale],
  }));
  let fixed = 0;
  for (const fix of fixes) {
    const request = asked.get(fix.id);
    if (!request) continue;
    const [index, field, sub] = fix.id.split(".");
    const draft = out[Number(index)];
    const text = fix.text.replace(/\s+/g, " ").trim();
    if (!draft || !text) continue;
    const mustName =
      offering && request.problems.some((p) => p.startsWith("does not name"));
    const ok =
      field === "rationale"
        ? reasonProblems(text, checks).length === 0
        : !copyFault(text, request.limit, checks.ledger) &&
          !looksCutOff(text) &&
          !(field === "subheadline" && readsAsList(text)) &&
          !(field === "cta" && !isAction(text)) &&
          (!mustName ||
            [...contentStems(offering)].every((stem) =>
              contentStems(text).has(stem),
            ));
    if (!ok) continue;
    if (field === "rationale") draft.rationale[Number(sub)] = text;
    else if (field === "footerLines") draft.footerLines[Number(sub)] = text;
    else if (field === "title" || field === "headline") draft[field] = text;
    else if (field === "subheadline" || field === "cta") draft[field] = text;
    else continue;
    asked.delete(fix.id);
    fixed += 1;
  }
  return { drafts: out, fixed };
}

/* The profile's statements of fact. Its voice (tone, favourite words,
   style) is left out: "Warm, unfussy" describes how the brand talks, and
   read as a fact it licensed "Still warm at 7am" on a cold cream pastry
   (round-3 live critic). */
export function brandFacts(brand: BrandSummary): (string | null | undefined)[] {
  return [
    brand.name,
    brand.overview,
    brand.businessType,
    brand.targetAudience,
    brand.offer,
    brand.primaryGoal,
    brand.values,
    brand.differentiators,
  ];
}

const FIELD_NAMES: Record<string, string> = {
  headline: "headline",
  subheadline: "subheadline",
  cta: "button",
  footerLines: "footer line",
  rationale: "reason (why this works)",
};

export function claimFields(directions: DirectionSpec[]): ClaimCheckField[] {
  return directions.flatMap((d, i) => {
    const out: ClaimCheckField[] = d.headline
      ? [
          {
            id: `${i}.headline`,
            field: FIELD_NAMES.headline,
            text: d.headline,
            limit: COPY_LIMITS.headline,
          },
        ]
      : [];
    if (d.subheadline) {
      out.push({
        id: `${i}.subheadline`,
        field: FIELD_NAMES.subheadline,
        text: d.subheadline,
        limit: COPY_LIMITS.subheadline,
      });
    }
    if (d.cta) {
      out.push({
        id: `${i}.cta`,
        field: FIELD_NAMES.cta,
        text: d.cta,
        limit: COPY_LIMITS.cta,
      });
    }
    d.footerLines.forEach((line, j) => {
      out.push({
        id: `${i}.footerLines.${j}`,
        field: FIELD_NAMES.footerLines,
        text: line,
        limit: COPY_LIMITS.footerLine,
      });
    });
    const copy = [d.headline, d.subheadline, d.cta, ...d.footerLines]
      .filter(Boolean)
      .join(" / ");
    d.rationale.forEach((reason, j) => {
      out.push({
        id: `${i}.rationale.${j}`,
        field: `${FIELD_NAMES.rationale}; that direction's copy is: ${copy}`,
        text: reason,
        limit: COPY_LIMITS.reason,
      });
    });
    return out;
  });
}

/**
 * The directions with every field the claim check flagged rewritten by its
 * own suggestion, when the suggestion passes the deterministic checks, or
 * left off. A headline cannot be left off and code never writes one (the
 * brief's internal title once stood in; round-8 code critic, break 3), so
 * a flagged headline with no rewrite that holds is reported lost and its
 * direction fails. Reasons are settled again after, so each direction
 * still shows at least two true ones.
 */
export function applyClaimCheck(
  directions: DirectionSpec[],
  flagged: readonly { id: string; statement: string; rewrite: string }[],
  checks: DirectionChecks,
  paintedScenes: (string | undefined)[],
  /** Stems both headlines may share, the brand's name, as the pair check
   *  ignores them. */
  ignore: ReadonlySet<string> = new Set(),
): {
  directions: DirectionSpec[];
  rewritten: number;
  dropped: number;
  headlinesLost: number[];
  headlineRefusals: HeadlineRefusal[];
} {
  const headlinesLost: number[] = [];
  const headlineRefusals: HeadlineRefusal[] = [];
  const out = directions.map((d) => ({
    ...d,
    footerLines: [...d.footerLines],
    rationale: [...d.rationale],
  }));
  const removed = new Set<string>();
  let rewritten = 0;
  let dropped = 0;
  for (const claim of flagged) {
    const [index, field, sub] = claim.id.split(".");
    const d = out[Number(index)];
    if (!d) continue;
    const text = claim.rewrite.replace(/\s+/g, " ").trim();
    const limit =
      field === "rationale"
        ? COPY_LIMITS.reason
        : field === "footerLines"
          ? COPY_LIMITS.footerLine
          : ((COPY_LIMITS as Record<string, number>)[field] ?? 0);
    /* A rewritten headline may not be its sibling's, nor the sibling's
       with a full stop or one word changed: the pair would read as one
       design drawn twice (round-4 live run, fashion; round-14 code critic,
       J31 and J32). The pair check's own headline measure and threshold. */
    const sibling =
      field === "headline" &&
      out.some(
        (other, j) =>
          j !== Number(index) &&
          isNearDuplicateHeadline(other.headline, text, ignore),
      );
    const holds =
      Boolean(text) &&
      !sibling &&
      !(field === "subheadline" && readsAsList(text)) &&
      !(field === "cta" && !isAction(text)) &&
      (field === "rationale"
        ? reasonProblems(text, checks).length === 0
        : !copyFault(text, limit, checks.ledger));
    if (holds) rewritten += 1;
    else dropped += 1;
    if (field === "headline") {
      if (holds) d.headline = text;
      else {
        headlinesLost.push(Number(index));
        const fault = text ? copyFault(text, limit, checks.ledger) : null;
        headlineRefusals.push({
          direction: Number(index),
          headline: d.headline,
          statement: claim.statement,
          rewrite: text,
          why: !text
            ? "the claim check offered no rewrite"
            : sibling
              ? "its rewrite is the other design's headline"
              : `its rewrite ${fault ?? "did not hold"}`,
        });
      }
    } else if (field === "subheadline" || field === "cta") {
      if (holds) d[field] = text;
      else delete d[field];
    } else if (field === "footerLines" || field === "rationale") {
      if (holds) d[field][Number(sub)] = text;
      else removed.add(`${index}.${field}.${sub}`);
    }
  }
  const settled = out.map((d, i) => {
    const footerLines = d.footerLines.filter(
      (_, j) => !removed.has(`${i}.footerLines.${j}`),
    );
    const rationale = d.rationale.filter(
      (_, j) => !removed.has(`${i}.rationale.${j}`),
    );
    const { reasons } = settleReasons(rationale, {
      copy: { ...d, footerLines },
      checks,
      product: d.productName,
      image: "pending",
      paintedScene: paintedScenes[i],
    });
    return {
      ...d,
      footerLines,
      footerStyle: footerLines.length > 0 ? d.footerStyle : ("none" as const),
      rationale: reasons,
    };
  });
  return {
    directions: settled,
    rewritten,
    dropped,
    headlinesLost,
    headlineRefusals,
  };
}

/** A headline the claim check flagged whose rewrite could not stand. */
export interface HeadlineRefusal {
  direction: number;
  headline: string;
  /** The words the check found the brief does not say. */
  statement: string;
  rewrite: string;
  /** Why the rewrite could not stand. */
  why: string;
}

/** What became of a direction whose headline was refused. */
export interface HeadlineRecovery {
  direction: number;
  refused: { headline: string; why: string }[];
  /** What the model wrote when asked once more. */
  candidates: string[];
  /** The headline that passed every check, or null: the direction fails. */
  recovered: string | null;
  /** Why no candidate stood, when none did. */
  why?: string;
  /** Each candidate that did not stand, with the check that refused it. */
  refusals: RecoveryRefusal[];
  /** The headline the delivered design draws, set by the job once it is
   *  delivered: a later pass may still move a recovered headline, and
   *  null means the direction was not delivered. */
  ships?: string | null;
}

/** The check that refused a recovered headline (round 14: at ba7a7ea
 *  three directions were lost with only "every headline it wrote broke a
 *  rule" to show for nine candidates). */
export type RecoveryRule =
  | "length"
  | "copy"
  | "already a headline"
  | "subheadline repeats it"
  | "near-duplicate"
  | "claim check"
  | "claim check unreachable";

export interface RecoveryRefusal {
  headline: string;
  rule: RecoveryRule;
  why: string;
}

function closestPair(
  fresh: ComparableDirection[],
  existing: ComparableDirection[],
  options: Parameters<typeof directionOverlap>[2],
): {
  overlap: DirectionOverlap;
  later: number;
  other: ComparableDirection;
} | null {
  let worst: {
    overlap: DirectionOverlap;
    later: number;
    other: ComparableDirection;
  } | null = null;
  fresh.forEach((direction, i) => {
    const others = [...existing, ...fresh.slice(0, i)];
    for (const other of others) {
      const overlap = directionOverlap(other, direction, options);
      if (!worst || overlap.max > worst.overlap.max) {
        worst = { overlap, later: i, other };
      }
    }
  });
  return worst;
}

function sharedWords(
  a: ComparableDirection,
  b: ComparableDirection,
  ignore: ReadonlySet<string>,
): string[] {
  const copy = (d: ComparableDirection) =>
    contentStems([d.headline, d.subheadline, d.cta].join(" "), ignore);
  const other = copy(b);
  return [...copy(a)].filter((s) => other.has(s)).slice(0, 8);
}

/**
 * Writes the directions: one structured call for all of them, then the
 * rules that make them a usable set.
 *
 *  1. Fit: any field over its limit, carrying a fact the brief does not
 *     hold, or a reason claiming a position or size, goes back to the model
 *     once, all in one call, to be rewritten whole (fitRequests). Cutting it
 *     would leave a broken clause on the client's design.
 *  2. Every draft is brought inside the contract (finalize.ts), which never
 *     cuts a clause and keeps only reasons true of the copy it settles.
 *  3. If any two say the same thing (text-overlap.ts), the later one is
 *     written again, once, with the overlap named; it buys a pair of real
 *     alternatives instead of one design drawn twice.
 *  4. Layouts are forced apart (layouts.ts), last, because a redraft can
 *     propose a new layout.
 *
 * The first call is the spec's one generateObject; the fit and the redraft
 * are paid only when the first answer needs them, and the eval measures how
 * often it does.
 */
export async function draftDirections({
  context,
  imageSource,
  image,
  lenses,
  recentLayouts,
  memorySummary,
  existing = [],
  claimChecker = checkClaims,
  briefReader = readBriefWithModel,
  footerRepeatChecker = checkFooterRepeats,
  footerRewriter = askFooterRewrites,
  headlineRewriter = rewriteHeadline,
  headlineRecoverer = recoverHeadline,
  factWriter = writeFacts,
}: DraftDirectionsInput): Promise<DraftDirectionsResult> {
  const hasLogo = Boolean(context.brand?.logoUrl);
  const showImage =
    image !== null && image.bytes.byteLength <= ART_DIRECTOR_IMAGE_MAX_BYTES;
  const system = buildDirectionsSystemPrompt(context.brandSummary, hasLogo, {
    memorySummary,
    recentLayouts,
  });
  const checks: DirectionChecks = {
    ledger: factLedger(
      [
        context.briefText,
        context.title,
        ...brandFacts(context.brandSummary),
        memorySummary,
      ],
      2,
    ),
    briefText: context.briefText ?? "",
    title: context.title ?? "",
    audience: context.brandSummary.targetAudience,
  };
  const ignore = contentStems(context.brandSummary.name);
  const briefWords = contentStems(
    [context.briefText, context.title].filter(Boolean).join(" "),
  );
  const overlapOptions = {
    compareScenes: imageSource === "ko",
    ignore,
    briefWords,
  };
  let modelCalls = 1;
  const region = brandRegion([
    ...brandFacts(context.brandSummary),
    context.brandSummary.websiteUrl,
  ]);
  /* Beside the directions call, so the reading adds no wait. */
  const reading = briefReader({
    briefText: checks.briefText,
    title: checks.title,
  })
    .catch((err) => {
      console.error("brief read failed", err);
      return null;
    })
    .then((raw) => settleBriefRead(raw, checks.briefText, region));

  /* Whether the copy was written looking at the photograph. A reason about
     what the photo shows is only trusted when it was. */
  let imageSeen = false;

  /* A fact-heavy brief now and then comes back off the schema (round-4
     live run, the masterclass): one more ask, with what failed in the
     log, rather than losing the job to a single sample. */
  async function ask(prompt: string, count: number, withImage: boolean) {
    try {
      return await askOnce(prompt, count, withImage);
    } catch (err) {
      if ((err as Error)?.name !== "AI_NoObjectGeneratedError") throw err;
      console.error(
        "directions answer did not match the schema; asking again",
        {
          text: String((err as { text?: unknown }).text ?? "").slice(0, 2000),
          cause: String((err as { cause?: unknown }).cause ?? "").slice(
            0,
            2000,
          ),
        },
      );
      return askOnce(prompt, count, withImage);
    }
  }

  async function askOnce(prompt: string, count: number, withImage: boolean) {
    modelCalls += 1;
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema: directionsResponseSchema(count),
      system,
      maxOutputTokens: DIRECTIONS_MAX_OUTPUT_TOKENS,
      experimental_repairText: repairDirectionsFor(count),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...(withImage && image
              ? [
                  {
                    type: "image" as const,
                    image: image.bytes,
                    mediaType: image.contentType,
                  },
                ]
              : []),
          ],
        },
      ],
    });
    return object.directions;
  }

  /* Seeing the photograph improves the copy; it is never a reason to lose the
     design. A provider that refuses image parts gets the text-only brief. */
  async function askWithImageFallback(
    buildPrompt: (attached: boolean) => string,
    count: number,
  ) {
    if (!showImage) return ask(buildPrompt(false), count, false);
    try {
      const answer = await ask(buildPrompt(true), count, true);
      imageSeen = true;
      return answer;
    } catch (err) {
      console.error("art director could not take the photograph", err);
      imageSeen = false;
      return ask(buildPrompt(false), count, false);
    }
  }

  const fit = { asked: 0, fixed: 0 };
  async function fitted(drafts: DirectionDraft[]): Promise<DirectionDraft[]> {
    const offering = (await reading).offering?.phrase ?? "";
    const requests = fitRequests(drafts, checks, offering);
    if (requests.length === 0) return drafts;
    fit.asked += requests.length;
    const askFits = () => {
      modelCalls += 1;
      return generateObject({
        model: getModel("strategy"),
        schema: fitResponseSchema,
        system,
        maxOutputTokens: 2000,
        experimental_repairText: repairFitText,
        prompt: buildFitPrompt(context, requests),
      });
    };
    try {
      /* Asked once more when the first call fails: a headline the model
         could not deliver fails its direction, since code never writes
         one (round-8 code critic, break 3). */
      const { object } = await askFits().catch((err) => {
        console.error("direction fit pass failed; asking once more", err);
        return askFits();
      });
      const applied = applyFits(
        drafts,
        requests,
        object.fixes,
        checks,
        offering,
      );
      fit.fixed += applied.fixed;
      return applied.drafts;
    } catch (err) {
      /* Settled as written: a field that does not fit is cut at a clause or
         left off, and a headline that cannot be drawn as written fails its
         direction (headlineLost), since code never writes one. */
      console.error("direction fit pass failed; settling as written", err);
      return drafts;
    }
  }

  const finalize = (draft: DirectionDraft) =>
    finalizeDirection(draft, {
      aspectRatio: context.aspectRatio,
      checks,
      paintedScene: imageSource === "ko" ? draft.backgroundPrompt : undefined,
    });

  const drafts = await askWithImageFallback(
    (attached) =>
      buildDirectionsPrompt(context, {
        lenses,
        imageSource,
        imageAttached: attached,
        existing,
      }),
    lenses.length,
  );
  const finalized = (await fitted(drafts)).map(finalize);
  const directions = finalized.map((f) => f.direction);
  const reports = finalized.map((f) => f.report);

  let redrafted = false;
  let worst = closestPair(directions, existing, overlapOptions);
  if (worst && isNearDuplicate(worst.overlap)) {
    const { later, other } = worst;
    const lens = lenses[later];
    const tooCloseTo = [
      ...existing,
      ...directions.filter((_, i) => i !== later),
    ].map((d) => ({
      title: d.title,
      headline: d.headline,
      layout: d.layout,
    }));
    try {
      const [again] = await askWithImageFallback(
        (attached) =>
          buildRedraftPrompt(context, {
            lens,
            imageSource,
            imageAttached: attached,
            tooCloseTo,
            sharedWords: sharedWords(
              directions[later],
              other,
              new Set([...ignore, ...briefWords]),
            ),
          }),
        1,
      );
      const [refit] = await fitted([again]);
      const candidate = finalize(refit);
      const losesHeadline =
        candidate.report.headlineLost && !reports[later].headlineLost;
      const trial = directions.map((d, i) =>
        i === later ? candidate.direction : d,
      );
      const retried = closestPair(trial, existing, overlapOptions);
      /* Kept only if it actually moved apart. A redraft that came back just
         as close is no better, and the original at least passed the gate of
         being the model's first answer to the full brief. */
      if (
        retried &&
        retried.overlap.max < worst.overlap.max &&
        !losesHeadline
      ) {
        directions[later] = candidate.direction;
        reports[later] = candidate.report;
        worst = retried;
        redrafted = true;
      }
    } catch (err) {
      console.error("direction redraft failed; keeping the first draft", err);
    }
  }
  /**
   * Before a headline is declared lost, the model is asked once more for
   * that direction's headline, told what was refused and why, and to keep
   * clear of the other design's headline (round 12: at a958ac0 the claim
   * check's rewrite of conference-ko's "Can African cities beat the heat?"
   * could not stand, and the case shipped one design). One ask and at
   * most one claim check per lost direction; a candidate stands only if it
   * fits, states nothing the brief does not, repeats no other headline,
   * keeps the pair apart and passes the claim check. Code never writes the
   * headline: with none standing, the direction fails.
   */
  async function recoverRefusedHeadlines({
    lost,
    refusedHeadlines,
  }: {
    lost: number[];
    refusedHeadlines: { headline: string; why: string }[][];
  }): Promise<HeadlineRecovery[]> {
    const outcomes: HeadlineRecovery[] = [];
    /* Directions are recovered one after another, each against the
       headlines that will ship: a lost direction still waiting has none,
       and one already recovered has its new one. Checked in one batch,
       two lost directions each kept clear of the other's refused headline
       and both shipped "Weekend brunch starts here" (round-12 code critic,
       J21c). */
    const waiting = new Set(lost);
    const everyRefused = lost.flatMap((j) =>
      refusedHeadlines[j].map((r) => r.headline),
    );
    for (const i of lost) {
      waiting.delete(i);
      const refused = refusedHeadlines[i].filter((r) => r.headline);
      /* A direction whose recovery already failed ships nothing, so its
         refused headline is no headline to keep clear of (round-14 code
         critic, finding 5). */
      const failed = new Set(
        outcomes.filter((o) => o.recovered === null).map((o) => o.direction),
      );
      const shipping = directions.filter(
        (_, j) => j !== i && !waiting.has(j) && !failed.has(j),
      );
      const others = [...existing, ...shipping]
        .map((d) => d.headline)
        .filter(Boolean);
      modelCalls += 1;
      const asked = await headlineRecoverer({
        refused,
        subheadline: directions[i].subheadline,
        cta: directions[i].cta,
        others,
        briefText: checks.briefText,
        title: checks.title,
      });
      const outcome: HeadlineRecovery = {
        direction: i,
        refused,
        candidates: asked ?? [],
        recovered: null,
        refusals: [],
      };
      outcomes.push(outcome);
      if (asked === null) {
        outcome.why = "the headline model could not be reached";
        continue;
      }
      if (asked.length === 0) {
        outcome.why = "the model wrote no headline";
        continue;
      }
      const seen = new Set(
        [...others, ...everyRefused].map((h) => h.trim().toLowerCase()),
      );
      const refusalOf = (
        candidate: string,
      ): Omit<RecoveryRefusal, "headline"> | null => {
        if (candidate.length > REWRITTEN_HEADLINE_MAX) {
          return {
            rule: "length",
            why: `${candidate.length} characters, limit ${REWRITTEN_HEADLINE_MAX}`,
          };
        }
        const fault = copyFault(candidate, COPY_LIMITS.headline, checks.ledger);
        if (fault) return { rule: "copy", why: fault };
        if (seen.has(candidate.trim().toLowerCase())) {
          return {
            rule: "already a headline",
            why: "another design's headline, or one already refused",
          };
        }
        /* A headline the subheadline repeats blocks the fact writer from
           writing a missing fact below it (eval run a at 4931c2e:
           pottery-evening-ko's "One evening of wheel-throwing" over "A
           wheel-throwing evening with Bisi Adeleke" left "₦25,000 a seat"
           off). Only the candidate's own repeat counts: a subheadline that
           repeats the button's number does so whatever the headline says,
           and once refused every candidate. */
        const repeat = aboveRepeatsBy({
          headline: candidate,
          subheadline: directions[i].subheadline,
          cta: directions[i].cta,
        }).find((r) => r.field === "headline");
        if (repeat)
          return { rule: "subheadline repeats it", why: repeat.repeat };
        /* Only pairs the candidate is in: a pair of other designs that
           is already close says nothing about this headline. */
        const withCandidate = { ...directions[i], headline: candidate };
        const nearest = [...existing, ...shipping]
          .map((other) => ({
            other,
            overlap: directionOverlap(other, withCandidate, overlapOptions),
          }))
          .find(({ overlap }) => isNearDuplicate(overlap));
        if (nearest) {
          const { other, overlap } = nearest;
          return {
            rule: "near-duplicate",
            why: `reads as "${other.headline}" (headline ${overlap.headline.toFixed(2)}, copy ${overlap.copy.toFixed(2)}, title ${overlap.title.toFixed(2)})`,
          };
        }
        return null;
      };
      const apart: string[] = [];
      for (const candidate of asked) {
        const refusal = refusalOf(candidate);
        if (refusal) outcome.refusals.push({ headline: candidate, ...refusal });
        else apart.push(candidate);
      }
      if (apart.length === 0) {
        outcome.why =
          "every headline it wrote broke a rule a headline is held to";
        continue;
      }
      modelCalls += 1;
      const flaggedAgain = await claimChecker({
        fields: apart.map((text, k) => ({
          id: `${i}.headline.${k}`,
          field: FIELD_NAMES.headline,
          text,
          limit: COPY_LIMITS.headline,
        })),
        briefText: checks.briefText,
        title: checks.title,
        brand: context.brandSummary,
      });
      /* Unchecked copy is not delivered in place of checked copy. */
      if (flaggedAgain === null) {
        outcome.refusals.push(
          ...apart.map((headline) => ({
            headline,
            rule: "claim check unreachable" as const,
            why: "the claim check could not be reached",
          })),
        );
        outcome.why = "the claim check could not be reached";
        continue;
      }
      const flagOf = (k: number) =>
        flaggedAgain.find((f) => f.id === `${i}.headline.${k}`);
      const heldAt = apart.findIndex((_, k) => !flagOf(k));
      apart
        .slice(0, heldAt === -1 ? apart.length : heldAt)
        .forEach((headline, k) => {
          outcome.refusals.push({
            headline,
            rule: "claim check",
            why: `found "${flagOf(k)?.statement ?? ""}", which the brief does not say`,
          });
        });
      if (heldAt === -1) {
        outcome.why = "the claim check flagged every headline it wrote";
        continue;
      }
      const held = apart[heldAt];
      directions[i] = { ...directions[i], headline: held };
      outcome.recovered = held;
    }
    return outcomes;
  }

  const fields = claimFields(directions);
  const flagged =
    fields.length > 0
      ? await claimChecker({
          fields,
          briefText: checks.briefText,
          title: checks.title,
          brand: context.brandSummary,
        })
      : [];
  if (fields.length > 0) modelCalls += 1;
  const claimed = applyClaimCheck(
    directions,
    flagged ?? [],
    checks,
    directions.map((d) =>
      imageSource === "ko" ? d.backgroundPrompt : undefined,
    ),
    ignore,
  );
  directions.splice(0, directions.length, ...claimed.directions);
  const refusedHeadlines = directions.map((_, i) => [
    ...reports[i].copyFallbacks
      .filter((f) => f.field === "headline" && f.to === null)
      .map((f) => ({
        headline: f.from,
        why:
          copyFault(f.from, COPY_LIMITS.headline, checks.ledger) ??
          "it could not be drawn",
      })),
    ...claimed.headlineRefusals
      .filter((r) => r.direction === i)
      .map((r) => ({
        headline: r.headline,
        why: `the claim check found "${r.statement}", which the brief does not say, and ${r.why}`,
      })),
  ]);
  const headlineRecovery = await recoverRefusedHeadlines({
    lost: directions
      .map((_, i) => i)
      .filter(
        (i) => reports[i].headlineLost || claimed.headlinesLost.includes(i),
      ),
    refusedHeadlines,
  });
  const headlineLost = directions.map(
    (_, i) =>
      (reports[i].headlineLost || claimed.headlinesLost.includes(i)) &&
      !headlineRecovery.some((r) => r.direction === i && r.recovered),
  );
  const claimCheck: ClaimCheckOutcome = {
    available: flagged !== null,
    flagged: flagged?.length ?? 0,
    rewritten: claimed.rewritten,
    dropped: claimed.dropped,
    statements: (flagged ?? []).map((f) => f.statement),
    headlineRefusals: claimed.headlineRefusals,
  };

  const read = await reading;
  /* A pair that still repeats one headline after the redraft and the claim
     check gets a new one written for the later direction (round-6 eval:
     "Three shots. One flight." twice, and "Senior React engineers" beside
     "We're Hiring Senior React Engineers"). */
  /* A direction whose headline was lost ships nothing, so no pair is
     held to the headline it was refused: the pass moved the one design
     that ships away from its own valid headline for a sibling that never
     did (round-15 code critic, finding 4, J40). */
  const live = directions.map((_, i) => i).filter((i) => !headlineLost[i]);
  const livePair = (set: readonly (typeof directions)[number][]) => {
    const pair = closestPair(
      live.map((i) => set[i]),
      existing,
      overlapOptions,
    );
    return pair ? { ...pair, later: live[pair.later] } : null;
  };
  let finalPair = livePair(directions);
  let headlineRewritten = false;
  const headlinesBefore = directions.map((d) => d.headline);
  if (finalPair && isNearDuplicate(finalPair.overlap)) {
    const later = finalPair.later;
    /* The later direction first; in a fresh pair the earlier one too, when
       only it can move (round-6 eval: "Latte Art Masterclass" beside
       "Learn Latte Art", both naming the event as they must). */
    const movable =
      existing.length === 0 && live.length === 2
        ? [later, live[0] === later ? live[1] : live[0]]
        : [later];
    const withHeadline = (target: number, headline: string, sub: string) =>
      directions.map((d, i) => {
        if (i !== target) return d;
        const { subheadline: _old, ...others } = d;
        return { ...others, headline, ...(sub ? { subheadline: sub } : {}) };
      });
    const separates = (trial: typeof directions) => {
      const retried = livePair(trial);
      return retried && !isNearDuplicate(retried.overlap) ? retried : null;
    };
    const fitsHeadline = (candidate: string) =>
      Boolean(candidate) &&
      !copyFault(candidate, COPY_LIMITS.headline, checks.ledger);
    for (const target of movable) {
      const sub = directions[target].subheadline ?? "";
      /* A different idea, written for it by the model and held to every
         rule a headline is. Code never draws its own words here: the
         brief's internal title and the offering's name once stood in
         (round-8 code critic, break 3). A promoted sentence keeps the
         words the pair shares and reads as copy moved up (round-6 eval). */
      const others = [
        ...existing,
        ...directions.filter((_, i) => i !== target && !headlineLost[i]),
      ].map((d) => d.headline);
      const otherStems = contentStems(others.join(" "), ignore);
      const avoid = (
        directions[target].headline.match(/[\p{L}\p{N}'-]+/gu) ?? []
      ).filter((word) =>
        [...contentStems(word, ignore)].some((stem) => otherStems.has(stem)),
      );
      modelCalls += 1;
      const written =
        (await headlineRewriter({
          headline: directions[target].headline,
          subheadline: sub || undefined,
          cta: directions[target].cta,
          others,
          avoid,
          briefText: checks.briefText,
          title: checks.title,
        })) ?? [];
      const apart = written.filter(
        (candidate) =>
          fitsHeadline(candidate) &&
          separates(withHeadline(target, candidate, sub)),
      );
      if (apart.length > 0) {
        modelCalls += 1;
        const flagged = await claimChecker({
          fields: apart.map((text, i) => ({
            id: `${target}.headline.${i}`,
            field: "headline",
            text,
            limit: COPY_LIMITS.headline,
          })),
          briefText: checks.briefText,
          title: checks.title,
          brand: context.brandSummary,
        });
        /* Unchecked copy is not delivered in place of checked copy. */
        const held =
          flagged === null
            ? undefined
            : apart.find(
                (_, i) =>
                  !flagged.some((f) => f.id === `${target}.headline.${i}`),
              );
        if (held) {
          const trial = withHeadline(target, held, sub);
          directions[target] = trial[target];
          finalPair = separates(trial) ?? finalPair;
          headlineRewritten = true;
          break;
        }
      }
      /* Last, the subheadline's first sentence moves up, the rest stays
         below, when it fits a headline and the pair then reads apart. */
      const firstSentence = /^[^.!?]+[.!?]/.exec(sub)?.[0].trim() ?? sub.trim();
      const promoted = firstSentence.replace(/[.]$/, "");
      if (fitsHeadline(promoted)) {
        const trial = withHeadline(
          target,
          promoted,
          sub.slice(firstSentence.length).trim(),
        );
        const retried = separates(trial);
        if (retried) {
          directions[target] = trial[target];
          finalPair = retried;
          headlineRewritten = true;
          break;
        }
      }
    }
  }
  /* Two buttons with one label make short copy read as one (round-6 eval,
     conference: "Register Free" twice put the pair over the copy bar).
     The later one goes; a button is optional, the facts are not on it. */
  if (finalPair && isNearDuplicate(finalPair.overlap)) {
    const later = finalPair.later;
    const label = directions[later].cta?.trim().toLowerCase();
    const shared =
      label &&
      [
        ...existing,
        ...directions.filter((_, i) => i !== later && !headlineLost[i]),
      ].some((d) => d.cta?.trim().toLowerCase() === label);
    if (shared) {
      const { cta: _cta, ...withoutButton } = directions[later];
      const trial = directions.map((d, i) => (i === later ? withoutButton : d));
      const retried = livePair(trial);
      if (retried && !isNearDuplicate(retried.overlap)) {
        directions[later] = withoutButton;
        finalPair = retried;
      }
    }
  }
  worst = finalPair ?? worst;

  if (read.dropped.length > 0) {
    console.error("brief read: answers not held to the brief", read.dropped);
  }
  const resolved = resolveBriefProducts(
    reports.map((r) => r.modelProduct.name),
    `${checks.briefText} ${checks.title}`,
  );
  /* The reader's phrase is the brief's whole name for what it offers, read
     as a person reads it: "cold brew", not the "ice" one shared word grew
     into (round-4 code critic). The model's names are the fallback when
     the reader could not be reached. */
  const products = resolved.map((p) =>
    read.offering
      ? { name: read.offering.phrase, from: "read" as const }
      : plausibleProduct(p.name)
        ? p
        : { name: "", from: "none" as const },
  );
  const looks = reports.map((r) => r.modelProduct.look);
  const named = directions.map((d, i) => {
    const { name, from } = products[i];
    if (!name) return { ...d, productName: "", productLook: "" };
    const look = looks[i] || looks.find(Boolean) || "";
    /* The model's own name still helps recognise the product when the
       brief's words for it are fewer ("strawberry" of "Strawberry
       Napoleon"). */
    const modelName = reports[i].modelProduct.name;
    const hint =
      from === "model" ||
      !modelName ||
      modelName.toLowerCase() === name.toLowerCase()
        ? look
        : `${modelName}. ${look}`.trim();
    return {
      ...d,
      productName: name,
      productLook: hint.slice(0, DRAFT_LIMITS.productLook),
    };
  });
  const coverFacts = withVenueOrBrand(
    coverFactsOf(read),
    context.brandSummary.name,
  );
  const product = named.find((d) => d.productName)?.productName ?? "";
  const deduped = dropFooterRepeats(named, coverFacts, product);
  const coveredFooters = deduped.directions;
  /* Repeats in other words are marked by a model and dropped by code only
     when no stated fact goes with them (footer-repeats.ts). */
  const hasFooter = coveredFooters.some((d) => d.footerLines.length > 0);
  const firstMarks = hasFooter ? await footerRepeatChecker(coveredFooters) : [];
  if (hasFooter) modelCalls += 1;
  /* Every marked item that carries a fact gets a merge attempt: a second,
     targeted ask for the ones the first answer gave no rewrite. */
  const needing = firstMarks
    ? marksNeedingRewrite(coveredFooters, firstMarks, coverFacts)
    : [];
  const rewrites =
    needing.length > 0 ? await footerRewriter(coveredFooters, needing) : [];
  if (needing.length > 0) modelCalls += 1;
  const repeatMarks =
    firstMarks?.map((mark) => {
      const found = rewrites?.find((r) => r.id === mark.id);
      return found && !hasSubheadlineRewrite(mark)
        ? { ...mark, field: found.field, rewrite: found.rewrite }
        : mark;
    }) ?? null;
  /* A merge rewrites the copy above, so it is held like any correction:
     the brief's facts, language and offering, and the claim check. */
  const mergeHolds = correctionCheck({
    ledger: checks.ledger,
    facts: coverFacts,
    offering: read.offering?.phrase ?? "",
    checker: async (input) => {
      modelCalls += 1;
      return claimChecker(input);
    },
    briefText: checks.briefText,
    title: checks.title,
    brand: context.brandSummary,
  });
  const nearDuplicateSet = (set: typeof coveredFooters) => {
    const pair = closestPair(
      live.map((i) => set[i]),
      existing,
      overlapOptions,
    );
    return pair !== null && isNearDuplicate(pair.overlap);
  };
  const apartBeforeMerges = !nearDuplicateSet(coveredFooters);
  const repeatDrops = await settleMarkedRepeats(
    coveredFooters,
    repeatMarks ?? [],
    coverFacts,
    mergeHolds,
    (merged) => !apartBeforeMerges || !nearDuplicateSet(merged),
  );
  const echoes = dropButtonEchoes(repeatDrops.directions, coverFacts);
  /* Model writes, code verifies (Oluwaseyi's ruling, round 7): what a
     direction leaves out is written in by the model and checked here,
     never appended by code (fact-writer.ts). */
  const written = await settleFacts({
    directions: echoes.directions,
    facts: coverFacts,
    ledger: checks.ledger,
    writer: factWriter,
    claimCheck: (fields) =>
      claimChecker({
        fields,
        briefText: checks.briefText,
        title: checks.title,
        brand: context.brandSummary,
      }),
    briefText: checks.briefText,
    title: checks.title,
    keepsApart: (set) =>
      nearDuplicateSet(echoes.directions) || !nearDuplicateSet(set),
    wordsOfOthers: (set, id) =>
      distinctiveWords(
        [...existing, ...set.filter((_, j) => j !== id && !headlineLost[j])]
          .flatMap((d) => [d.headline, d.subheadline, d.cta])
          .filter(Boolean)
          .join(" "),
        new Set([...ignore, ...briefWords, ...contentStems(set[id].cta)]),
      ),
  });
  modelCalls += written.modelCalls;
  const final = dropFooterRepeats(written.directions, coverFacts, product);
  /* A drop shortens the copy the near-duplicate rule compares, so one that
     would make a pair that reads apart read as one is not made. */
  const apartBeforeDrops = !nearDuplicateSet(final.directions);
  const drawnIn = final.directions.reduce(
    (set, d, i) => {
      const trial = set.map((other, j) =>
        j === i ? withoutRepeatingSubheadline(d, coverFacts) : other,
      );
      return !apartBeforeDrops || !nearDuplicateSet(trial) ? trial : set;
    },
    [...final.directions],
  );
  const factCoverage: FactCoverage = {
    facts: coverFacts.map((f) => f.text),
    stated: drawnIn.map((d) =>
      coverFacts.filter((f) => factStated(f, d)).map((f) => f.text),
    ),
    added: written.added.filter(({ direction, fact }) =>
      coverFacts.some(
        (f) => f.text === fact && factStated(f, drawnIn[direction]),
      ),
    ),
    leftOff: drawnIn.flatMap((d, i) =>
      coverFacts
        .filter((f) => !factStated(f, d))
        .map(
          (f) =>
            written.leftOff.find(
              (l) => l.direction === i && l.fact === f.text,
            ) ?? {
              direction: i,
              fact: f.text,
              reason: "dropped as a repeat after it was written in",
            },
        ),
    ),
    repeatsDropped: deduped.dropped + final.dropped,
    rewritesRefused: written.refused,
    headlinesRewritten: written.headlines.filter(
      ({ direction, to }) => drawnIn[direction].headline === to,
    ),
  };
  /* Footers and subheadlines change here (repeats dropped, facts written
     in), so a reason settled against the old copy ("the footer carries
     the date") is held again to the new one (round-5 eval). */
  const covered = drawnIn.map((d, i) =>
    d.headline === headlinesBefore[i] &&
    d.footerLines.join("|") === named[i].footerLines.join("|") &&
    d.subheadline === named[i].subheadline &&
    d.headline === named[i].headline &&
    d.cta === named[i].cta
      ? d
      : {
          ...d,
          rationale: settleReasons(d.rationale, {
            copy: d,
            checks,
            product: d.productName,
            image: "pending",
            paintedScene: imageSource === "ko" ? d.backgroundPrompt : undefined,
          }).reasons,
        },
  );

  const forced = forceDistinctLayouts(
    covered.map((d) => d.layout),
    recentLayouts,
    existing.map((d) => d.layout),
  );
  let layoutsForced = 0;
  const settled = covered.map((d, i) => {
    if (forced[i] === d.layout) return d;
    layoutsForced += 1;
    return { ...d, layout: forced[i] };
  });

  return {
    directions: settled,
    drafts,
    reports,
    fit,
    checks,
    imageSeen,
    layoutsForced,
    redrafted,
    headlineRewritten,
    headlineLost,
    headlineRecovery,
    overlap: worst?.overlap ?? null,
    modelCalls,
    productSources: products.map((p) => p.from),
    read,
    coverFacts,
    factCoverage,
    claimCheck,
    footerRepeats: {
      available: repeatMarks !== null,
      outcomes: [...repeatDrops.outcomes, ...echoes.outcomes],
    },
  };
}

/* What the model's own product names fall back to when the reader is down,
   and what they must not be: a shop ("Ikeja salon"), an offer ("Free
   cookie"), a possessive ("bakery's") or a colour and material with no
   thing ("black leather"), all of which were painted and checked as the
   product (round-5 code critic). */
const NOT_A_THING =
  /^(?:black|white|tan|olive|navy|red|blue|green|gold|silver|pink|cream|grey|gray|brown|beige|ivory|leather|silk|cotton|linen|wool|denim|suede|velvet|satin|lace|wood|wooden|glass|ceramic|steel|brass|copper|organza|aso-oke|adire|ankara)$/i;

export function plausibleProduct(name: string): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const last = words[words.length - 1];
  if (/['’]s?$/.test(last)) return false;
  if (/^(?:free|new|our|the|your)$/i.test(words[0])) return false;
  if (NOT_AN_OFFERING.test(last) || NOT_AN_OFFERING.test(name.trim())) {
    return false;
  }
  return !words.every((w) => NOT_A_THING.test(w));
}
