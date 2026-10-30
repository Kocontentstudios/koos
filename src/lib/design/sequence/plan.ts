import { generateObject } from "ai";
import type { z } from "zod";
import {
  buildArcCopyPrompt,
  buildArcPrompt,
  buildFixPrompt,
  buildSequenceSystemPrompt,
  type ClaimedFrame,
  type FrameFix,
  hookNames,
} from "@/lib/ai/prompts/design-sequence";
import { getModel } from "@/lib/ai/provider";
import { formatRules } from "@/lib/design/formats";
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
import { COPY_LIMITS } from "@/lib/jobs/directions/schema";
import {
  type ArcFrame,
  type ArcPoint,
  pointPool,
  settleArc,
  sparePoints,
  titleFromClaim,
} from "./arc";
import { withConsistentCasing } from "./casing";
import {
  FRAME_BOUNDS,
  type FrameBeat,
  type PlannedSequence,
  type PlanSequenceInput,
  type PlanSequenceResult,
  PRESENTATION_ASPECT,
  type SequenceKind,
} from "./contract";
import { withFactsDrawn } from "./coverage";
import {
  blockingFaults,
  COVERAGE,
  type CopyFault,
  type FaultRules,
  faultScore,
  hookScore,
  setFaults,
} from "./faults";
import { namesFree } from "./hook";
import { withFigureLayout } from "./layouts";
import { inventedOn, sequenceFacts, sequenceLedger } from "./ledger";
import { textStatesPrice } from "./points";
import { repairSequenceFor } from "./repair";
import { type FrameRepeat, withoutFactWords, withoutRepeats } from "./repeats";
import {
  type ArcAnswer,
  arcResponseSchema,
  type CopyAnswer,
  copyResponseSchema,
  type FrameRewrite,
  rewriteResponseSchema,
} from "./schema";
import { settledTitle } from "./title";
import { validateSequence } from "./validate";

const ARC_MAX_OUTPUT_TOKENS = 3000;
/** N frames of copy, the button and the other openings. */
const COPY_MAX_OUTPUT_TOKENS = 8000;
const FIX_MAX_OUTPUT_TOKENS = 6000;

/* The brief read, the arc, the copy and two fix calls are five; the rest
   covers a schema retry on each. Past that a fix is skipped rather than
   the wait growing. */
export const MAX_MODEL_CALLS = 8;

/** Thrown in place of a call past MAX_MODEL_CALLS. */
export class ModelBudgetError extends Error {
  constructor() {
    super(`planSequence: past its ${MAX_MODEL_CALLS} model calls`);
    this.name = "ModelBudgetError";
  }
}

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

const tidyLines = (lines: readonly string[]) =>
  lines.map((line) => line.trim()).filter(Boolean);

/** A frame with the model's rewrite in place of its words. Role, layout,
 *  image and scene are kept: the rewrite is of copy only. */
export function withRewrite(beat: FrameBeat, rewrite: FrameRewrite): FrameBeat {
  /* The action frame's button is the set's only one (H3): a rewrite that
     leaves it empty keeps the button it had. */
  const cta = beat.role === "cta" ? rewrite.cta.trim() || beat.cta : "";
  return {
    ...beat,
    title: settledTitle(rewrite.title, beat.title),
    headline: rewrite.headline.trim(),
    subheadline: rewrite.subheadline.trim(),
    cta,
    footerLines: tidyLines(rewrite.footerLines),
  };
}

/** The words a set of frames draws, for telling versions apart. */
function copyKey(frames: readonly FrameBeat[]): string {
  return JSON.stringify(
    frames.map((f) => [
      f.title,
      f.headline,
      f.subheadline,
      f.cta,
      f.footerLines,
    ]),
  );
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
      title: frame.title,
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

const coverageOf = (faults: readonly CopyFault[]) =>
  faults.filter((f) => f.weight >= COVERAGE).length;

/** Whether `after` ships with fewer faults than `before`, never by losing
 *  coverage: a brief fact or the offering is never the price of a fix. */
export function improves(
  before: PlannedSequence,
  after: PlannedSequence,
  rules: FaultRules,
): boolean {
  const was = setFaults(before, rules);
  const now = setFaults(after, rules);
  return (
    coverageOf(now) <= coverageOf(was) && faultScore(now) < faultScore(was)
  );
}

/**
 * The fix call's versions, kept frame by frame only where the set is left
 * with fewer faults (improves). Code chooses between the model's answers;
 * it never writes a word of any. Returns the frames whose rewrite was kept.
 */
export function applyFixes(
  plan: PlannedSequence,
  rewrites: readonly FrameRewrite[],
  asked: ReadonlySet<number>,
  rules: FaultRules,
  tidy: (frames: readonly FrameBeat[]) => FrameBeat[] = (f) => [...f],
  retitle: ReadonlySet<number> = new Set(),
): { plan: PlannedSequence; kept: number[] } {
  let current = plan;
  const kept: number[] = [];
  for (const index of [...asked].sort((a, b) => a - b)) {
    if (!current.frames[index]) continue;
    let best: PlannedSequence | null = null;
    for (const rewrite of rewrites.filter((r) => r.frame - 1 === index)) {
      /* A title is the frame's name on its card: it changes only where
         the title itself was at fault, never because a version renamed
         it. */
      const rewritten = (b: FrameBeat) => {
        const next = withRewrite(b, rewrite);
        return retitle.has(index) ? next : { ...next, title: b.title };
      };
      const frames = tidy(
        current.frames.map((b, i) => (i === index ? rewritten(b) : b)),
      );
      if (copyKey(frames) === copyKey(current.frames)) continue;
      const candidate = { ...current, frames };
      if (improves(best ?? current, candidate, rules)) best = candidate;
    }
    if (best) {
      current = best;
      kept.push(index);
    }
  }
  return { plan: current, kept };
}

/** The frames whose title, or whose claim, is at fault: the only ones a
 *  fix may rename. */
export function retitled(
  faults: readonly CopyFault[],
  fixes: readonly FrameFix[],
): Set<number> {
  return new Set([
    ...faults.filter((f) => f.field === "title").map((f) => f.frame),
    ...fixes.filter((f) => f.newClaim).map((f) => f.index),
  ]);
}

/** The faults the fix call is asked about, by frame. */
export function fixesFor(faults: readonly CopyFault[]): FrameFix[] {
  const byFrame = new Map<number, string[]>();
  for (const fault of faults) {
    const list = byFrame.get(fault.frame) ?? [];
    if (!list.includes(fault.detail)) list.push(fault.detail);
    byFrame.set(fault.frame, list);
  }
  return [...byFrame.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, list]) => ({ index, faults: list }));
}

/* A body frame whose headline makes another frame's point cannot be fixed
   by rewording it: its claim is the other frame's. */
const POINT_TAKEN =
  /makes frame \d+'s point|says what frame \d+|built on the words of frame \d+/;

/** Body frames whose point another frame already makes, each given the
 *  next spare point of the pool as a new claim. */
export function newClaims(
  plan: PlannedSequence,
  blocking: readonly CopyFault[],
  spare: readonly number[],
  pool: readonly ArcPoint[],
): Map<number, string> {
  const claims = new Map<number, string>();
  const left = [...spare];
  for (const fault of blocking) {
    const beat = plan.frames[fault.frame];
    if (beat?.role !== "body" || claims.has(fault.frame)) continue;
    if (!POINT_TAKEN.test(fault.detail)) continue;
    const next = left.shift();
    if (next === undefined) break;
    claims.set(fault.frame, pool[next].text);
  }
  return claims;
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Whether `text` can stand as a headline of `kind` as written. */
function fitsHeadline(text: string, kind: SequenceKind): boolean {
  return (
    text.length > 0 &&
    text.length <= COPY_LIMITS.headline &&
    wordCount(text) <= formatRules(kind).headlineWords + 2
  );
}

/**
 * The faults that must not ship and that no rewrite fixed, settled in
 * code by removing words or putting a sourced claim in their place, each
 * kept only where the set improves (improves):
 *  - a carousel's price in a headline: the price's words cut where the
 *    rest reads on its own, else the frame's claim as headline;
 *  - a headline making another frame's point: the frame's own claim, in
 *    its source's words;
 *  - a subheadline that is not a sentence: left out;
 *  - a title another frame has: one made from the frame's claim.
 */
export function withLastResorts(
  plan: PlannedSequence,
  arc: readonly ArcFrame[],
  rules: FaultRules,
): { plan: PlannedSequence; applied: string[] } {
  let current = plan;
  const applied: string[] = [];
  const attempt = (frame: number, change: Partial<FrameBeat>, what: string) => {
    const candidate = {
      ...current,
      frames: current.frames.map((b, i) =>
        i === frame ? { ...b, ...change } : b,
      ),
    };
    if (!improves(current, candidate, rules)) return false;
    current = candidate;
    applied.push(`frame ${frame + 1}: ${what}`);
    return true;
  };
  for (const fault of blockingFaults(setFaults(current, rules))) {
    const beat = current.frames[fault.frame];
    if (!beat) continue;
    const claim = arc[fault.frame]?.claim ?? "";
    if (fault.field === "headline" && /gives the price/.test(fault.detail)) {
      const price = rules.facts.find(
        (f) => f.kind === "price" && fault.detail.includes(`"${f.text}"`),
      );
      const cut = price ? withoutFactWords(beat.headline, price) : null;
      if (cut && attempt(fault.frame, { headline: cut }, "price cut")) continue;
      const priced = price !== undefined && textStatesPrice(price, claim);
      if (!priced && fitsHeadline(claim, current.kind)) {
        attempt(fault.frame, { headline: claim }, "headline set to its claim");
      }
    } else if (fault.field === "headline" && POINT_TAKEN.test(fault.detail)) {
      if (fitsHeadline(claim, current.kind)) {
        attempt(fault.frame, { headline: claim }, "headline set to its claim");
      }
    } else if (fault.field === "subheadline" && beat.subheadline) {
      attempt(fault.frame, { subheadline: "" }, "subheadline left out");
    } else if (fault.field === "title") {
      const title = titleFromClaim(claim);
      if (title) attempt(fault.frame, { title }, "title made from its claim");
    }
  }
  return { plan: current, applied };
}

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
 *     beside the action, distinct titles, layouts.
 *  4. The copy call writes every frame told only its own claim and the
 *     claims and facts it must leave to the others, and frame 1 three ways;
 *     code keeps the opening with the fewest faults.
 *  5. Code finds what is wrong (setFaults) and the fix call rewrites only
 *     the frames at fault; a version is kept only where the set improves.
 *     A frame whose point is still another frame's takes a spare point and
 *     is rewritten once more, with every fault still blocking.
 *  6. What still blocks is settled in code (withLastResorts), the
 *     headlines take one casing, and a fact still missing is written in
 *     the brief's words (withFactsDrawn).
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
    console.error("sequence brief read failed", err);
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
  const facts = sequenceFacts(read, brandName);
  const offering = read.offering?.phrase ?? null;
  const offeringIndex = facts.findIndex((f) => f.kind === "product");
  const names = hookNames(context, offering);
  const free = namesFree(brandName, offering);
  const pool = pointPool({
    facts,
    briefText,
    brand: context.brandSummary,
    kind,
    free,
    slots: frameCount - 1,
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
        console.error(
          "sequence answer did not match the schema; asking again",
          {
            text: String((err as { text?: unknown }).text ?? "").slice(0, 2000),
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
      console.error("sequence planner could not take the photograph", err);
      imageRefused = true;
      return once(false);
    }
  }

  const actionFacts = facts.filter(
    (f) => f.kind === "contact" || (kind === "carousel" && f.kind === "price"),
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
  };
  const tidy = (frames: readonly FrameBeat[]) =>
    withoutRepeats(frames, facts, offering, owners);
  const written = assemblePlan({ kind, context }, arcAnswer, arc.frames, copy);
  const hooks = chosenHook(
    { ...written, frames: tidy(written.frames) },
    [written.frames[0], ...copy.otherHooks],
    rules,
  );
  let plan = hooks.plan;
  const draft = plan;

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
        retitled(faults, fixes),
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
      console.error("sequence fix call failed; keeping the copy", err);
    }
  };

  await fixRound(setFaults(plan, rules));
  const blocking = blockingFaults(setFaults(plan, rules));
  if (blocking.length > 0) {
    await fixRound(
      blocking,
      newClaims(plan, blocking, sparePoints(arc, pool, facts, free), pool),
    );
  }

  const resorts = withLastResorts(plan, arc.frames, rules);
  plan = resorts.plan;
  const cased = withConsistentCasing(plan.frames, [
    briefText,
    context.title,
    brandName,
    offering,
    ...brandFacts(context.brandSummary),
  ]);
  plan = { ...plan, frames: cased.frames };
  const filled = withFactsDrawn(plan, facts, owners);
  plan = { ...filled.plan, frames: filled.plan.frames.map(withFigureLayout) };

  const problems = validateSequence(plan, rules);
  const invented = plan.frames.flatMap((beat, frame) =>
    inventedOn(beat, ledger).map((text) => ({ frame, text })),
  );
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
    layoutsChanged: arc.layoutsChanged,
    hookChosen: hooks.index,
    fixRounds,
    lastResorts: resorts.applied,
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
