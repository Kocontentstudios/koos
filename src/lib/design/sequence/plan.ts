import { generateObject } from "ai";
import type { z } from "zod";
import {
  buildArcCopyPrompt,
  buildArcPrompt,
  buildAuditPrompt,
  buildFixPrompt,
  buildSequenceSystemPrompt,
  type ClaimedFrame,
  hookNames,
} from "@/lib/ai/prompts/design-sequence";
import { getModel } from "@/lib/ai/provider";
import {
  ART_DIRECTOR_IMAGE_MAX_BYTES,
  brandFacts,
} from "@/lib/jobs/directions/brief";
import { brandRegion } from "@/lib/jobs/directions/brief-facts";
import {
  type BriefReader,
  readBriefWithModel,
  settleBriefRead,
} from "@/lib/jobs/directions/brief-read";
import {
  type ArcFrame,
  actionPrices,
  pointPool,
  settleArc,
  sparePoints,
} from "./arc";
import { auditFlags } from "./audit";
import { withConsistentCasing } from "./casing";
import {
  FRAME_BOUNDS,
  type FrameBeat,
  type PlannedSequence,
  type PlanSequenceInput,
  type PlanSequenceResult,
  PRESENTATION_ASPECT,
} from "./contract";
import { withFactsDrawn } from "./coverage";
import {
  blockingFaults,
  type CopyFault,
  type FaultRules,
  type Flag,
  hookScore,
  setFaults,
} from "./faults";
import { applyFixes, copyKey, fixesFor, newClaims, tidyLines } from "./fixes";
import { shipGate, unsourcedOnSet } from "./gate";
import { namesFree } from "./hook";
import { withFigureLayout } from "./layouts";
import { sequenceFacts, sequenceLedger } from "./ledger";
import { profileStatements } from "./points";
import { repairSequenceFor } from "./repair";
import { type FrameRepeat, withoutRepeats } from "./repeats";
import {
  type ArcAnswer,
  arcResponseSchema,
  auditResponseSchema,
  type CopyAnswer,
  copyResponseSchema,
  rewriteResponseSchema,
} from "./schema";
import { settledTitle, type TitleRules, withSettledTitles } from "./title";
import { validateSequence } from "./validate";

const ARC_MAX_OUTPUT_TOKENS = 3000;
/** N frames of copy, the button and the other openings. */
const COPY_MAX_OUTPUT_TOKENS = 8000;
const AUDIT_MAX_OUTPUT_TOKENS = 2000;
const FIX_MAX_OUTPUT_TOKENS = 6000;

/* The brief read, the arc, the copy, the audit and two fix calls are six;
   the rest covers a schema retry on three of them. Past that a fix is
   skipped rather than the wait growing. */
export const MAX_MODEL_CALLS = 9;

/** Thrown in place of a call past MAX_MODEL_CALLS. */
export class ModelBudgetError extends Error {
  constructor() {
    super(`planSequence: past its ${MAX_MODEL_CALLS} model calls`);
    this.name = "ModelBudgetError";
  }
}

/* A model error carries the answer's text, which is the client's copy:
   its name and message say what failed without putting a brief in a log. */
const failure = (err: unknown) => ({
  name: (err as Error)?.name,
  message: String((err as Error)?.message ?? err).slice(0, 300),
});

export interface PlanSequenceDeps {
  /** Reads the brief's facts, offering and people (brief-read.ts). */
  briefReader?: BriefReader;
}

/** The contract's result, plus the copy faults no rewrite fixed: drawable,
 *  so never a problem the job fails a set for, but measured by the eval and
 *  logged, so a fault that ships is counted rather than silent. */
export interface PlannedSequenceResult extends PlanSequenceResult {
  faults: FrameRepeat[];
  /** Words on a frame that neither the brief nor the brand vouches for
   *  (inventedOn), by zero-based frame. Held to the ledger a regenerate is
   *  refused on, so planning and regenerating apply one standard. */
  invented: { frame: number; text: string }[];
  /** Brief facts the copy left out that code wrote onto a frame's footer
   *  in the brief's own words (withFactsDrawn). */
  factsDrawn: string[];
}

type BrandFrame = Pick<
  ArcAnswer,
  | "palette"
  | "logoPlacement"
  | "logoFree"
  | "logoFreeQuote"
  | "backgroundTreatment"
  | "footerStyle"
>;

/** The settled arc and its copy as one plan every frame of the set
 *  shares. */
export function assemblePlan(
  input: Pick<PlanSequenceInput, "kind" | "context">,
  brand: BrandFrame,
  arc: readonly ArcFrame[],
  copy: Pick<CopyAnswer, "frames" | "cta">,
): PlannedSequence {
  const frames: FrameBeat[] = arc.map((frame, i) => {
    const written = copy.frames[i];
    return {
      role: frame.role,
      title: settledTitle(written.title, frame.title),
      headline: written.headline.trim(),
      subheadline: written.subheadline.trim(),
      cta: frame.role === "cta" ? copy.cta.trim() : "",
      footerLines: tidyLines(written.footerLines),
      layout: frame.layout,
      showsImage: frame.showsImage,
      backgroundPrompt: written.backgroundPrompt.trim(),
    };
  });
  /* The set has one footer system. A model that chose none and then gave
     a frame its venue and phone would lose them, so the lines win. */
  const anyLines = frames.some((f) => f.footerLines.length > 0);
  const footerStyle =
    anyLines && brand.footerStyle === "none" ? "text" : brand.footerStyle;
  return {
    kind: input.kind,
    palette: { ...brand.palette },
    logoPlacement: brand.logoPlacement,
    logoFree: brand.logoFree,
    logoFreeQuote: brand.logoFreeQuote,
    backgroundTreatment: brand.backgroundTreatment,
    footerStyle,
    aspectRatio:
      input.kind === "presentation"
        ? PRESENTATION_ASPECT
        : input.context.aspectRatio,
    frames,
  };
}

/** The hook among `versions` that leaves frame 1 with the fewest faults;
 *  the first (the writer's own pick) on a tie. */
export function chosenHook(
  plan: PlannedSequence,
  versions: readonly Pick<FrameBeat, "headline" | "subheadline">[],
  rules: FaultRules,
): { plan: PlannedSequence; index: number } {
  const hook = plan.frames[0];
  if (!hook || versions.length === 0) return { plan, index: 0 };
  const beats = versions.map((v) => ({
    ...hook,
    headline: v.headline.trim(),
    subheadline: v.subheadline.trim(),
  }));
  const scores = beats.map((beat) => hookScore(beat, plan, rules));
  const index = scores.indexOf(Math.min(...scores));
  return {
    plan: {
      ...plan,
      frames: plan.frames.map((beat, i) => (i === 0 ? beats[index] : beat)),
    },
    index,
  };
}

/* A brief read can take the piece for the offering ("Investor deck"):
   the hook is then told to name it, and talks about the deck instead of
   what the deck is about. Only a phrase whose head is the piece itself:
   "Desk posts" or "Slides and sandals" can be what a brand sells. */
const NAMES_THE_PIECE =
  /^(?:(?:an?|the|our|this)\s+)?(?:[\p{L}-]+\s+){0,2}(?:deck|presentation|carousel)$/iu;

/**
 * The set's plan, arc first:
 *  1. The brief is read the way the directions path reads it
 *     (readBriefWithModel, settleBriefRead, sequenceFacts), so a set is
 *     held to the same facts a single design is.
 *  2. Code builds the pool of points the set may make (pointPool): the
 *     brief's clauses, its facts that are a point on their own, the brand
 *     profile's clauses, none overlapping another.
 *  3. The arc call ranks the pool and assigns one point to each frame,
 *     writing only the hook's angle; code settles it (settleArc): no point
 *     overlapping another frame's, every fact on exactly one frame, prices
 *     beside the action, layouts.
 *  4. The copy call writes every frame told only its own claim and the
 *     claims and facts it must leave to the others, and frame 1 three ways;
 *     code keeps the opening with the fewest faults.
 *  5. The audit call reads the written set for what words cannot show:
 *     two frames making one point in other words, a statement no source
 *     gives, and which spare points are still unsaid (auditFlags).
 *  6. Code finds what is wrong (setFaults, the audit's findings among
 *     them) and the fix call rewrites only the frames at fault, a frame
 *     whose point is another's given a spare point; a version is kept only
 *     where the set improves.
 *  7. What must not ship is settled in code (shipGate): unsourced words
 *     cut, a priced or repeated headline set to its claim, a broken or
 *     missing subheadline set to its claim, a hook's echo cut, the
 *     offering named on the hook. What still blocks after it, the gate's
 *     own cuts included, goes to a second fix call and through the gate
 *     again. A fact still missing is written in the brief's words
 *     (withFactsDrawn), every title is settled against its frame's final
 *     copy (withSettledTitles) and the set takes one casing.
 *  At most MAX_MODEL_CALLS calls, the brief read included.
 */
export async function planSequence(
  input: PlanSequenceInput,
  { briefReader = readBriefWithModel }: PlanSequenceDeps = {},
): Promise<PlannedSequenceResult> {
  const { context, kind, frameCount, imageSource, image } = input;
  const bounds = FRAME_BOUNDS[kind];
  if (
    !Number.isInteger(frameCount) ||
    frameCount < bounds.min ||
    frameCount > bounds.max
  ) {
    throw new RangeError(
      `planSequence: a ${kind} is ${bounds.min} to ${bounds.max} frames, not ${frameCount} (clampFrameCount)`,
    );
  }
  const started = Date.now();
  const memorySummary = input.memorySummary ?? "";
  const aspectRatio =
    kind === "presentation" ? PRESENTATION_ASPECT : context.aspectRatio;
  const hasImage = imageSource !== "none";
  const system = buildSequenceSystemPrompt(
    context.brandSummary,
    Boolean(context.brand?.logoUrl),
    { memorySummary, recentLayouts: input.recentLayouts },
  );
  const briefText = context.briefText ?? "";
  let modelCalls = 1;

  const raw = await briefReader({
    briefText,
    title: context.title ?? "",
  }).catch((err) => {
    console.error("sequence brief read failed", failure(err));
    return null;
  });
  const read = settleBriefRead(
    raw,
    briefText,
    brandRegion([
      ...brandFacts(context.brandSummary),
      context.brandSummary.websiteUrl,
    ]),
  );
  const brandName = context.brandSummary.name;
  const facts = sequenceFacts(read, brandName, briefText).filter(
    (f) => f.kind !== "product" || !NAMES_THE_PIECE.test(f.text.trim()),
  );
  const readOffering = read.offering?.phrase ?? null;
  const offering =
    readOffering && NAMES_THE_PIECE.test(readOffering.trim())
      ? null
      : readOffering;
  const offeringIndex = facts.findIndex((f) => f.kind === "product");
  const names = hookNames(context, offering);
  const free = namesFree(brandName, offering);
  const atAction = actionPrices(facts, kind, briefText);
  const pool = pointPool({
    facts,
    briefText,
    brand: context.brandSummary,
    kind,
    free,
    slots: frameCount - 1,
    atAction,
  });

  const showImage =
    imageSource === "upload" &&
    image !== null &&
    image.bytes.byteLength <= ART_DIRECTOR_IMAGE_MAX_BYTES;
  let imageSeen = false;
  let imageRefused = false;

  async function askOnce<S extends z.ZodTypeAny>(
    schema: S,
    prompt: string,
    withImage: boolean,
    maxOutputTokens: number,
    count: number | undefined,
  ): Promise<z.infer<S>> {
    if (modelCalls >= MAX_MODEL_CALLS) throw new ModelBudgetError();
    modelCalls += 1;
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema,
      system,
      maxOutputTokens,
      experimental_repairText: repairSequenceFor(count),
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
    return object as z.infer<S>;
  }

  /* An answer off the schema is asked for once more, as the directions
     call is; a photograph the provider refuses is dropped rather than the
     set, since seeing it only improves the copy, and is not sent again. */
  async function ask<S extends z.ZodTypeAny>(
    schema: S,
    buildPrompt: (attached: boolean) => string,
    maxOutputTokens: number,
    { count, looks = true }: { count?: number; looks?: boolean } = {},
  ): Promise<z.infer<S>> {
    const once = async (withImage: boolean) => {
      try {
        return await askOnce(
          schema,
          buildPrompt(withImage),
          withImage,
          maxOutputTokens,
          count,
        );
      } catch (err) {
        if ((err as Error)?.name !== "AI_NoObjectGeneratedError") throw err;
        /* The answer's text is the client's copy: its length says what
           went wrong without putting their brief in the log. */
        console.error(
          "sequence answer did not match the schema; asking again",
          {
            chars: String((err as { text?: unknown }).text ?? "").length,
          },
        );
        return askOnce(
          schema,
          buildPrompt(withImage),
          withImage,
          maxOutputTokens,
          count,
        );
      }
    };
    if (!looks || !showImage || imageRefused) return once(false);
    try {
      const answer = await once(true);
      imageSeen = true;
      return answer;
    } catch (err) {
      if (err instanceof ModelBudgetError) throw err;
      console.error(
        "sequence planner could not take the photograph",
        failure(err),
      );
      imageRefused = true;
      return once(false);
    }
  }

  const actionFacts = facts.filter(
    (f, n) => f.kind === "contact" || atAction.has(n),
  );
  const arcAnswer = await ask(
    arcResponseSchema(frameCount),
    (attached) =>
      buildArcPrompt(context, {
        kind,
        frameCount,
        aspectRatio,
        pool,
        actionFacts: actionFacts.map((f) => f.text),
        offering,
        imageSource,
        imageAttached: attached,
      }),
    ARC_MAX_OUTPUT_TOKENS,
    { count: frameCount },
  );
  const arc = settleArc(arcAnswer, {
    pool,
    facts,
    kind,
    offeringFact: offeringIndex >= 0 ? offeringIndex : null,
    hasImage,
    recentLayouts: input.recentLayouts,
    free,
    atAction,
  });
  const owners = arc.frames.map((f) => f.facts);
  const claimed: ClaimedFrame[] = arc.frames.map((f) => ({
    role: f.role,
    title: f.title,
    claim: f.claim,
    facts: f.facts.map((n) => facts[n].text),
    layout: f.layout,
    showsImage: f.showsImage,
  }));

  const copy = await ask(
    copyResponseSchema(frameCount),
    () =>
      buildArcCopyPrompt(context, {
        kind,
        frames: claimed,
        offering,
        imageSource,
        aspectRatio,
      }),
    COPY_MAX_OUTPUT_TOKENS,
    { count: frameCount },
  );

  const ledger = sequenceLedger(context, memorySummary);
  const profile = [
    ...profileStatements(context.brandSummary),
    context.brandSummary.targetAudience?.trim() ?? "",
  ].filter(Boolean);
  const titleRules: TitleRules = {
    sources: [
      briefText,
      ...Object.values(context.brandSummary).filter(
        (v): v is string => typeof v === "string",
      ),
    ],
  };
  const rules: FaultRules = {
    frameCount,
    facts,
    offering,
    hasImage,
    brandName,
    names,
    ledger,
    owners,
    claims: arc.frames.map((f) => f.claim),
    titleSources: titleRules.sources,
    atAction,
  };
  const arcTitles = arc.frames.map((f) => [f.title]);
  const tidy = (frames: readonly FrameBeat[]) =>
    withSettledTitles(
      withoutRepeats(frames, facts, offering, owners),
      titleRules,
      arcTitles,
    );
  const written = assemblePlan({ kind, context }, arcAnswer, arc.frames, copy);
  const hooks = chosenHook(
    { ...written, frames: tidy(written.frames) },
    [written.frames[0], ...copy.otherHooks],
    rules,
  );
  let plan = hooks.plan;
  const draft = plan;

  let spares = sparePoints(arc, pool, facts, free);
  let unsourced: Flag[] = [];
  try {
    const audit = await ask(
      auditResponseSchema,
      () =>
        buildAuditPrompt(context, {
          kind,
          frames: plan.frames,
          spares: spares.map((i) => ({ number: i + 1, text: pool[i].text })),
          profile,
        }),
      AUDIT_MAX_OUTPUT_TOKENS,
      { looks: false },
    );
    const flags = auditFlags(audit, plan.frames, ledger.text);
    rules.flagged = flags;
    unsourced = flags.filter((f) => f.kind === "unsourced");
    const fresh = new Set(audit.freshSpares.map((n) => n - 1));
    spares = spares.filter((i) => fresh.has(i));
  } catch (err) {
    if (err instanceof ModelBudgetError) throw err;
    console.error(
      "sequence audit failed; fixing on code's faults alone",
      failure(err),
    );
  }

  const fixRounds: { asked: number[]; kept: number[]; claims: number[] }[] = [];
  const fixRound = async (
    faults: readonly CopyFault[],
    swaps = new Map<number, string>(),
  ) => {
    const fixes = fixesFor(faults).map((fix) => ({
      ...fix,
      newClaim: swaps.get(fix.index) ?? null,
    }));
    if (fixes.length === 0) return;
    try {
      const answer = await ask(
        rewriteResponseSchema,
        () =>
          buildFixPrompt(context, {
            kind,
            plan: plan.frames,
            frames: claimed,
            fixes,
            names,
          }),
        FIX_MAX_OUTPUT_TOKENS,
        { looks: false },
      );
      const applied = applyFixes(
        plan,
        answer.frames,
        new Set(fixes.map((f) => f.index)),
        rules,
        tidy,
      );
      plan = applied.plan;
      const swapped = fixes.filter(
        (f) => f.newClaim && applied.kept.includes(f.index),
      );
      for (const fix of swapped) {
        const claim = fix.newClaim ?? "";
        claimed[fix.index] = { ...claimed[fix.index], claim };
        arc.frames[fix.index] = { ...arc.frames[fix.index], claim };
        rules.claims = arc.frames.map((f) => f.claim);
      }
      fixRounds.push({
        asked: fixes.map((f) => f.index),
        kept: applied.kept,
        claims: swapped.map((f) => f.index),
      });
    } catch (err) {
      console.error("sequence fix call failed; keeping the copy", failure(err));
    }
  };

  const withSpares = async (faults: readonly CopyFault[]) => {
    const swaps = newClaims(plan, blockingFaults(faults), spares, pool);
    const taken = new Set(
      [...swaps.values()].map((claim) =>
        pool.findIndex((p) => p.text === claim),
      ),
    );
    await fixRound(faults, swaps);
    spares = spares.filter((i) => !taken.has(i));
  };
  const gate = () => {
    const result = shipGate(plan, {
      ...rules,
      claims: arc.frames.map((f) => f.claim),
      unsourced,
      spares: spares.map((i) => pool[i].text),
    });
    plan = result.plan;
    return result.applied;
  };
  await withSpares(setFaults(plan, rules));
  const gated = gate();
  const blocking = blockingFaults(setFaults(plan, rules));
  if (blocking.length > 0) {
    await withSpares(blocking);
    gated.push(...gate());
  }
  const filled = withFactsDrawn(plan, facts, owners);
  const cased = withConsistentCasing(
    withSettledTitles(filled.plan.frames, titleRules, arcTitles),
    [
      briefText,
      context.title,
      brandName,
      offering,
      ...brandFacts(context.brandSummary),
    ],
  );
  plan = { ...filled.plan, frames: cased.frames.map(withFigureLayout) };

  const problems = validateSequence(plan, rules);
  const invented = unsourcedOnSet(plan.frames, { ledger, unsourced });
  const faults = setFaults(plan, rules);
  console.info("design.sequence.planned", {
    kind,
    frames: frameCount,
    facts: facts.length,
    pool: pool.map((p) => p.source),
    arc: arc.frames.map((f) => ({ point: f.point, claim: f.claim })),
    pointsReplaced: arc.replaced,
    angleDropped: arc.angleDropped,
    unsourced: arc.unsourced,
    crowded: arc.crowded,
    sameAs: [...arc.sameAs].filter((_, i) => i % 2 === 0),
    flagged: [...(rules.flagged ?? []), ...unsourced],
    layoutsChanged: arc.layoutsChanged,
    hookChosen: hooks.index,
    fixRounds,
    gated,
    recased: cased.recased,
    problems: problems.map((p) => p.rule),
    invented,
    factsDrawn: filled.drawn,
    faults: faults.map((f) => `frame ${f.frame + 1} ${f.field}: ${f.detail}`),
    imageSeen,
    readAvailable: read.available,
    modelCalls,
    ms: Date.now() - started,
  });
  return {
    plan,
    facts,
    offering,
    problems,
    faults: faults.map((f) => ({ frame: f.frame, detail: f.detail })),
    invented,
    factsDrawn: filled.drawn,
    modelCalls,
    repaired: copyKey(plan.frames) !== copyKey(draft.frames),
  };
}
