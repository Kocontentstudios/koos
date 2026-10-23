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
import { brandRegion, coverBriefFacts, type FactCoverage } from "./brief-facts";
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
  /** Where each direction's product name came from: the model's own words,
   *  its sibling's, the brief's, or none. */
  productSources: ("model" | "sibling" | "brief" | "none")[];
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

/** The drafts with every rewrite that fixed its field applied. A rewrite
 *  that is itself over the limit or invents a fact is ignored. */
export function applyFits(
  drafts: DirectionDraft[],
  requests: FitRequest[],
  fixes: { id: string; text: string }[],
  checks: DirectionChecks,
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
    const ok =
      field === "rationale"
        ? reasonProblems(text, checks).length === 0
        : !copyFault(text, request.limit, checks.ledger) && !looksCutOff(text);
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
  let modelCalls = 0;

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
    const requests = fitRequests(drafts, checks);
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
      const applied = applyFits(drafts, requests, object.fixes, checks);
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

  const products = resolveBriefProducts(
    reports.map((r) => r.modelProduct.name),
    `${checks.briefText} ${checks.title}`,
  );
  const looks = reports.map((r) => r.modelProduct.look);
  const named = directions.map((d, i) => {
    const { name, from } = products[i];
    if (!name) return { ...d, productName: "", productLook: "" };
    const look = looks[i] || looks.find(Boolean) || "";
    /* The model's own name still helps recognise the product when the
       brief's words for it are fewer ("strawberry" of "Strawberry
       Napoleon"). */
    const hint =
      from === "model" || !reports[i].modelProduct.name
        ? look
        : `${reports[i].modelProduct.name}. ${look}`.trim();
    return {
      ...d,
      productName: name,
      productLook: hint.slice(0, DRAFT_LIMITS.productLook),
    };
  });
  const { directions: covered, coverage: factCoverage } = coverBriefFacts(
    named,
    checks.briefText,
    {
      region: brandRegion([
        ...brandFacts(context.brandSummary),
        context.brandSummary.websiteUrl,
      ]),
      product: named.find((d) => d.productName)?.productName ?? "",
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
    factCoverage,
    claimCheck,
  };
}
