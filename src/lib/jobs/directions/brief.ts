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
  type BriefFact,
  brandRegion,
  coverBriefFacts,
  type FactCoverage,
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
import {
  copyFault,
  type DirectionChecks,
  type FinalizeReport,
  finalizeDirection,
  settleReasons,
} from "./finalize";
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
  isNearDuplicate,
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

function claimFields(directions: DirectionSpec[]): ClaimCheckField[] {
  return directions.flatMap((d, i) => {
    const out: ClaimCheckField[] = [
      {
        id: `${i}.headline`,
        field: FIELD_NAMES.headline,
        text: d.headline,
        limit: COPY_LIMITS.headline,
      },
    ];
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

/* A headline the claim check refused falls back to the user's own words:
   the brief's title, else the product the brief names. Never the concept's
   title, which describes the idea to the client and reads as a label on
   the design (round-4 live run: "Origin voice"). */
function fallbackHeadline(d: DirectionSpec, checks: DirectionChecks): string {
  const product = d.productName
    ? d.productName.charAt(0).toUpperCase() + d.productName.slice(1)
    : "";
  return (
    [checks.title, product].find(
      (candidate) =>
        candidate && !copyFault(candidate, COPY_LIMITS.headline, checks.ledger),
    ) ?? d.headline
  );
}

/**
 * The directions with every field the claim check flagged rewritten by its
 * own suggestion, when the suggestion passes the deterministic checks, or
 * left off. A headline is never left off: it falls back to the brief's
 * title, the user's own words. Reasons are settled again after, so each
 * direction still shows at least two true ones.
 */
export function applyClaimCheck(
  directions: DirectionSpec[],
  flagged: readonly { id: string; statement: string; rewrite: string }[],
  checks: DirectionChecks,
  paintedScenes: (string | undefined)[],
): { directions: DirectionSpec[]; rewritten: number; dropped: number } {
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
    /* A rewritten headline may not be its sibling's: the pair would read
       as one design drawn twice (round-4 live run, fashion). */
    const sibling =
      field === "headline" &&
      out.some(
        (other, j) =>
          j !== Number(index) &&
          other.headline.toLowerCase() === text.toLowerCase(),
      );
    const holds =
      Boolean(text) &&
      !sibling &&
      (field === "rationale"
        ? reasonProblems(text, checks).length === 0
        : !copyFault(text, limit, checks.ledger));
    if (holds) rewritten += 1;
    else dropped += 1;
    if (field === "headline") {
      d.headline = holds ? text : fallbackHeadline(d, checks);
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
  return { directions: settled, rewritten, dropped };
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
}: DraftDirectionsInput): Promise<DraftDirectionsResult> {
  const hasLogo = Boolean(context.brand?.logoUrl);
  const showImage =
    image !== null && image.bytes.byteLength <= ART_DIRECTOR_IMAGE_MAX_BYTES;
  const system = buildDirectionsSystemPrompt(context.brandSummary, hasLogo, {
    memorySummary,
    recentLayouts,
  });
  const checks: DirectionChecks = {
    ledger: factLedger([
      context.briefText,
      context.title,
      ...brandFacts(context.brandSummary),
      memorySummary,
    ]),
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
    modelCalls += 1;
    try {
      const { object } = await generateObject({
        model: getModel("strategy"),
        schema: fitResponseSchema,
        system,
        maxOutputTokens: 2000,
        experimental_repairText: repairFitText,
        prompt: buildFitPrompt(context, requests),
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
      /* The deterministic settling below still keeps every clause whole;
         the user loses the rewrite, never the design. */
      console.error("direction fit pass failed; settling as written", err);
      return drafts;
    }
  }

  const finalize = (draft: DirectionDraft, lens: ConceptLens) =>
    finalizeDirection(draft, {
      aspectRatio: context.aspectRatio,
      checks,
      fallbackTitle: lens.lead,
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
  const finalized = (await fitted(drafts)).map((draft, i) =>
    finalize(draft, lenses[i]),
  );
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
      const candidate = finalize(refit, lens);
      const trial = directions.map((d, i) =>
        i === later ? candidate.direction : d,
      );
      const retried = closestPair(trial, existing, overlapOptions);
      /* Kept only if it actually moved apart. A redraft that came back just
         as close is no better, and the original at least passed the gate of
         being the model's first answer to the full brief. */
      if (retried && retried.overlap.max < worst.overlap.max) {
        directions[later] = candidate.direction;
        reports[later] = candidate.report;
        worst = retried;
        redrafted = true;
      }
    } catch (err) {
      console.error("direction redraft failed; keeping the first draft", err);
    }
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
  );
  directions.splice(0, directions.length, ...claimed.directions);
  const claimCheck: ClaimCheckOutcome = {
    available: flagged !== null,
    flagged: flagged?.length ?? 0,
    rewritten: claimed.rewritten,
    dropped: claimed.dropped,
    statements: (flagged ?? []).map((f) => f.statement),
  };

  const read = await reading;
  /* A pair that still repeats one headline, after the redraft and after
     the claim check (whose fallback is the brief's title, which one of the
     pair may already be), gets the user's own words for the later one
     (round-6 eval: "Three shots. One flight." twice, and "Senior React
     engineers" beside "We're Hiring Senior React Engineers"). */
  let finalPair = closestPair(directions, existing, overlapOptions);
  if (finalPair && isNearDuplicate(finalPair.overlap)) {
    const later = finalPair.later;
    const offering = read.offering?.phrase ?? "";
    /* The subheadline's first sentence moves up, the rest stays below. */
    const sub = directions[later].subheadline ?? "";
    const firstSentence = /^[^.!?]+[.!?]/.exec(sub)?.[0].trim() ?? "";
    const rest = sub.slice(firstSentence.length).trim();
    for (const [candidate, subheadline] of [
      [checks.title, sub],
      [
        offering ? offering.charAt(0).toUpperCase() + offering.slice(1) : "",
        sub,
      ],
      [firstSentence.replace(/[.]$/, ""), rest],
    ] as const) {
      if (
        !candidate ||
        copyFault(candidate, COPY_LIMITS.headline, checks.ledger)
      ) {
        continue;
      }
      const trial = directions.map((d, i) => {
        if (i !== later) return d;
        const { subheadline: _old, ...others } = d;
        return {
          ...others,
          headline: candidate,
          ...(subheadline ? { subheadline } : {}),
        };
      });
      const retried = closestPair(trial, existing, overlapOptions);
      if (retried && !isNearDuplicate(retried.overlap)) {
        directions[later] = trial[later];
        finalPair = retried;
        break;
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
      [...existing, ...directions.filter((_, i) => i !== later)].some(
        (d) => d.cta?.trim().toLowerCase() === label,
      );
    if (shared) {
      const { cta: _cta, ...withoutButton } = directions[later];
      const trial = directions.map((d, i) => (i === later ? withoutButton : d));
      const retried = closestPair(trial, existing, overlapOptions);
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
  const offeringNamed = named.map((d) => nameOffering(d, read, checks));
  const coverFacts = coverFactsOf(read);
  const { directions: drawnIn, coverage: factCoverage } = coverBriefFacts(
    offeringNamed,
    coverFacts,
    named.find((d) => d.productName)?.productName ?? "",
  );
  /* Coverage changes footers (repeats dropped, facts drawn in), so a reason
     settled against the old footer ("the footer carries the date") is held
     again to the new one (round-5 eval: two such reasons). */
  const covered = drawnIn.map((d, i) =>
    d.footerLines.join("|") === offeringNamed[i].footerLines.join("|") &&
    d.subheadline === offeringNamed[i].subheadline
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
    overlap: worst?.overlap ?? null,
    modelCalls,
    productSources: products.map((p) => p.from),
    read,
    coverFacts,
    factCoverage,
    claimCheck,
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

/**
 * A direction that still does not name what the brief promotes after the
 * fit pass names it in its subheadline, in the brief's words: as a lead-in
 * to the subheadline when that fits, else as the subheadline when there is
 * none. Round-6 eval: one textile direction called the aso-oke collection
 * "twelve autumn pieces" and never named it.
 */
export function nameOffering<
  D extends Pick<DirectionSpec, "headline" | "subheadline" | "cta">,
>(direction: D, read: Pick<BriefRead, "offering">, checks: DirectionChecks): D {
  const phrase = read.offering?.phrase ?? "";
  if (!phrase || namesOffering(direction, phrase)) return direction;
  const name = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  const sub = direction.subheadline?.trim() ?? "";
  const candidate = sub ? `${name}: ${sub}` : name;
  if (
    candidate.length > COPY_LIMITS.subheadline ||
    copyFault(candidate, COPY_LIMITS.subheadline, checks.ledger)
  ) {
    return direction;
  }
  return { ...direction, subheadline: candidate };
}
