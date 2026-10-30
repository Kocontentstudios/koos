import { generateObject } from "ai";
import type { z } from "zod";
import {
  buildFrameCopyPrompt,
  buildHookChoicePrompt,
  buildOutlinePrompt,
  buildSequenceChoicePrompt,
  buildSequenceEditPrompt,
  buildSequenceSystemPrompt,
  type FrameFix,
  HOOK_VERSIONS,
  hookNames,
} from "@/lib/ai/prompts/design-sequence";
import { getModel } from "@/lib/ai/provider";
import type { DesignContext } from "@/lib/design/context";
import {
  ART_DIRECTOR_IMAGE_MAX_BYTES,
  brandFacts,
} from "@/lib/jobs/directions/brief";
import {
  type BriefFact,
  brandRegion,
  drawnText,
  factStated,
  withVenueOrBrand,
} from "@/lib/jobs/directions/brief-facts";
import {
  type BriefReader,
  coverFactsOf,
  readBriefWithModel,
  settleBriefRead,
} from "@/lib/jobs/directions/brief-read";
import {
  type FactLedger,
  factLedger,
  inventedFacts,
} from "@/lib/jobs/directions/claims";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import {
  COPY_DRAFTS,
  choiceResponseSchema,
  chosenIndex,
  leastProblems,
  shownOrder,
} from "./choose";
import {
  FRAME_BOUNDS,
  type FrameBeat,
  type PlannedSequence,
  type PlanSequenceInput,
  type PlanSequenceResult,
  PRESENTATION_ASPECT,
  type SequenceKind,
  type SequenceProblem,
} from "./contract";
import { withFactsDrawn } from "./coverage";
import {
  hookFaults,
  hookPreviews,
  previewedFrames,
  unnamedOnHook,
} from "./hook";
import { withFigureLayout } from "./layouts";
import {
  type OutlineSettlement,
  repeatedPoints,
  settleOutline,
} from "./outline";
import {
  briefPoints,
  factOnlyFrames,
  misplacedPrices,
  profilePoints,
  profileStatements,
  statesPrice,
} from "./points";
import { repairSequenceFor } from "./repair";
import { type FrameRepeat, sequenceRepeats, withoutRepeats } from "./repeats";
import {
  type CopyAnswer,
  copyResponseSchema,
  type EditAnswer,
  editResponseSchema,
  type FrameRewrite,
  type OutlineAnswer,
  outlineResponseSchema,
} from "./schema";
import {
  factsUncovered,
  frameCopy,
  isWordBudgetProblem,
  type SequenceRules,
  validateSequence,
} from "./validate";

/** N frames of copy plus the shared brand frame. */
const COPY_MAX_OUTPUT_TOKENS = 8000;
const OUTLINE_MAX_OUTPUT_TOKENS = 3000;
const CHOICE_MAX_OUTPUT_TOKENS = 600;

/* The brief read, the outline and its one re-ask, two drafts, the draft
   choice, the edit pass and the hook choice are eight calls when every
   optional step runs; most plans make six. One more covers a single
   schema retry. Past that an optional step is skipped rather than the
   wait growing (round-2 critic: up to four attempts per logical call made
   a plan cost 24 to 33 s). A second edit pass (a re-read of the edited
   set) was measured in round 3 and moved nothing (non-repetition 3.61 to
   3.50 over the full matrix), so there is one. */
export const MAX_MODEL_CALLS = 9;

/** Thrown in place of a call past MAX_MODEL_CALLS. */
export class ModelBudgetError extends Error {
  constructor() {
    super(`planSequence: past its ${MAX_MODEL_CALLS} model calls`);
    this.name = "ModelBudgetError";
  }
}

/** The words a set of frames draws, for telling versions apart. */
function copyKey(frames: readonly FrameBeat[]): string {
  return JSON.stringify(
    frames.map((f) => [f.headline, f.subheadline, f.cta, f.footerLines]),
  );
}

/** `indexes` without a version that draws the same words as an earlier
 *  one: the editor is never asked to choose between two the same. */
export function distinctCopy(
  options: readonly PlannedSequence[],
  indexes: readonly number[],
): number[] {
  const seen = new Set<string>();
  return indexes.filter((i) => {
    const key = copyKey(options[i].frames);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** How one of several versions was chosen (choose.ts), for the trace. */
interface EditorChoice {
  index: number;
  by: "code" | "editor" | "fallback";
  scores: number[];
  why?: string;
}

export interface PlanSequenceDeps {
  /** Reads the brief's facts, offering and people (brief-read.ts). */
  briefReader?: BriefReader;
}

/** The contract's result, plus the copy faults (copyFaults) the planner
 *  could not get rewritten: drawable, so never a problem the job fails a
 *  set for, but measured by the eval and logged, so a flat hook that ships
 *  is counted rather than silent. */
export interface PlannedSequenceResult extends PlanSequenceResult {
  faults: FrameRepeat[];
  /** Words on a frame that neither the brief nor the brand vouches for
   *  (inventedOn), by zero-based frame, after the edit pass. Held to the
   *  ledger a regenerate is refused on, so planning and regenerating apply
   *  one standard; the set still ships, since the words are drawable, and
   *  the job records the count (round-4 critic, HIGH 2). */
  invented: { frame: number; text: string }[];
  /** Brief facts the copy left out that code wrote onto a frame's footer
   *  in the brief's own words (withFactsDrawn). */
  factsDrawn: string[];
}

/** The facts a set is held to, read exactly as draftDirections reads them
 *  (brief.ts): a venue the brief calls "our Yaba bar" is stated by the
 *  brand's name and the area, as a single design's would be. */
export function sequenceFacts(
  read: Parameters<typeof coverFactsOf>[0],
  brandName: string,
): BriefFact[] {
  return withVenueOrBrand(coverFactsOf(read), brandName);
}

/**
 * What the brief and brand vouch for. Unlike a single design's ledger, the
 * profile's statements (profileStatements) license what the brief does:
 * a thin brief's frame makes a profile point by decision (Oluwaseyi,
 * 2026-10-30), and round 4 refused "Hand-stitched soles" taken word for
 * word from the brand's differentiators because method claims were the
 * brief's alone. The goal licenses nothing: it is what the business wants,
 * not what is true (round-4 critic, HIGH 3).
 */
export function sequenceLedger(
  context: DesignContext,
  memorySummary: string,
): FactLedger {
  const brand = context.brandSummary;
  const statements = profileStatements(brand);
  const goal = brand.primaryGoal?.trim();
  const rest = brandFacts(brand).filter(
    (source) =>
      source?.trim() !== goal && !statements.includes(source?.trim() ?? ""),
  );
  return factLedger(
    [context.briefText, context.title, ...statements, ...rest, memorySummary],
    2 + statements.length,
  );
}

/** Numbers, days and claims on a frame that neither the brief nor the
 *  brand gives. Not a contract rule: the repair pass asks for them to come
 *  out, and the eval counts any that stay. */
export function inventedOn(beat: FrameBeat, ledger: FactLedger): string[] {
  return inventedFacts(drawnText(frameCopy(beat)), ledger);
}

/* A fact written word for word yet not counted is sharing its field with
   another of its kind, which reads as a choice and states neither (the
   fact forms' rule): round 6's deck wrote "Farmers pay ₦500 per crate per
   day. We are raising $750,000." in one subheadline. Saying only "no frame
   states it" got the same line back. */
export function uncoveredDetail(
  frames: readonly FrameBeat[],
  fact: BriefFact,
): string {
  const written = frames.some((beat) =>
    drawnText(frameCopy(beat)).toLowerCase().includes(fact.text.toLowerCase()),
  );
  return written
    ? `"${fact.text}" is written, but in a field with another ${fact.kind} or number, so it reads as a choice and states neither; give it a field of its own`
    : `no frame states "${fact.text}"`;
}

/** Problems a rewrite can fix, per frame, in words the model can act on. */
export function repairFixes(
  plan: PlannedSequence,
  problems: readonly SequenceProblem[],
  {
    facts,
    factsByFrame,
    ledger,
    offering,
    names = [],
    brandName = "",
  }: {
    facts: readonly BriefFact[];
    /** Zero-based fact indexes each frame was planned to state. */
    factsByFrame: readonly number[][];
    ledger: FactLedger;
    offering: string | null;
    /** What the hook must name (hookNames). */
    names?: readonly string[];
    brandName?: string;
  },
): FrameFix[] {
  const asked = new Map<number, string[]>();
  const add = (frame: number, problem: string) => {
    asked.set(frame, [...(asked.get(frame) ?? []), problem]);
  };
  const last = plan.frames.length - 1;
  for (const problem of problems) {
    switch (problem.rule) {
      case "copy-length":
      case "headline-repeat":
      case "offering-unnamed":
        if (problem.frame !== null) add(problem.frame, problem.detail);
        break;
      case "cta-last":
        if (plan.frames[last]?.role === "cta") add(last, problem.detail);
        break;
      default:
        /* Roles, count, layouts and the hook's image are structure the
           planner settles in code, so a rewrite of the words cannot fix
           them; fact coverage is asked for below, by the fact's owner. */
        break;
    }
  }
  /* A fact no frame states goes back to the frame the outline gave it,
     which was told to carry it. */
  for (const fact of factsUncovered(plan.frames, facts)) {
    const owner = factsByFrame.findIndex((owned) =>
      owned.includes(facts.indexOf(fact)),
    );
    add(owner >= 0 ? owner : last, uncoveredDetail(plan.frames, fact));
  }
  plan.frames.forEach((beat, i) => {
    for (const made of inventedOn(beat, ledger)) {
      add(i, `it states "${made}", which the brief does not give`);
    }
  });
  for (const repeat of copyFaults(
    plan.frames,
    facts,
    offering,
    names,
    brandName,
    plan.kind,
  )) {
    add(repeat.frame, repeat.detail);
  }
  /* The hook's preview is one point on two frames, and either may give it
     up: round 5's first run left the fault on 17 of 30 tuning runs while
     only the hook was asked to move, so the later frame is asked too and code keeps
     whichever version leaves the set with fewer faults. */
  for (const frame of previewedFrames(plan.frames, offering, brandName)) {
    add(
      frame,
      `it makes the point the hook opens on ("${plan.frames[0].headline}"); give this frame a point of its own`,
    );
  }
  const lastBeat = plan.frames[last];
  for (const price of misplacedFacts(plan.frames, facts, plan.kind)) {
    if (lastBeat && !factStated(price, lastBeat)) {
      add(
        last,
        `it must state the price "${price.text}" beside the action, now that the frame that gave it leaves it out`,
      );
    }
  }
  return [...asked.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, list]) => ({
      index,
      problems: list,
      mustState: (factsByFrame[index] ?? []).map((n) => facts[n].text),
    }));
}

const tidyLines = (lines: readonly string[]) =>
  lines.map((line) => line.trim()).filter(Boolean);

/** A frame with the model's rewrite in place of its words. Role, layout,
 *  image and scene are kept: the rewrite is of copy only. */
export function withRewrite(beat: FrameBeat, rewrite: FrameRewrite): FrameBeat {
  /* The action frame's button is the set's only one (H3): a rewrite that
     leaves it empty keeps the button it had (round-2 critic, probe P1). */
  const cta = beat.role === "cta" ? rewrite.cta.trim() || beat.cta : "";
  return {
    ...beat,
    title: rewrite.title.trim(),
    headline: rewrite.headline.trim(),
    subheadline: rewrite.subheadline.trim(),
    cta,
    footerLines: tidyLines(rewrite.footerLines),
  };
}

/* A frame that cannot be drawn, misses a fact or says a neighbour's
   headline costs more than one a word over its budget or with a phrase said
   twice: a rewrite that trades the first for the second is an
   improvement, never the reverse. */
const MAJOR = 3;

/* A brief fact no frame states, or a hook that does not say what is on
   offer, fails the set's coverage (H5), which an invented claim does not:
   round 3's partner deck traded "one room" for a hook naming nothing, and
   the eval lost the run. Coverage is never the price of another fix. */
const COVERAGE_WEIGHT = 2 * MAJOR;
const COVERAGE_RULES = new Set<SequenceProblem["rule"]>([
  "fact-uncovered",
  "offering-unnamed",
]);

function problemWeight(problem: SequenceProblem): number {
  if (isWordBudgetProblem(problem)) return 1;
  return COVERAGE_RULES.has(problem.rule) ? COVERAGE_WEIGHT : MAJOR;
}

/** How far a plan is from passing, for choosing between the model's
 *  answers. 0 is a plan with nothing left to fix. */
export function planScore(
  plan: PlannedSequence,
  {
    rules,
    ledger,
    names = [],
  }: { rules: SequenceRules; ledger: FactLedger; names?: readonly string[] },
): number {
  const problems = validateSequence(plan, rules).reduce(
    (n, p) => n + problemWeight(p),
    0,
  );
  const invented = plan.frames.reduce(
    (n, beat) => n + inventedOn(beat, ledger).length * MAJOR,
    0,
  );
  const brandName = rules.brandName ?? "";
  const faults = copyFaults(
    plan.frames,
    rules.facts,
    rules.offering,
    names,
    brandName,
    plan.kind,
  ).length;
  const hook = hookCopyFaults(
    plan.frames,
    rules.offering,
    names,
    brandName,
    rules.facts,
  );
  /* A name the hook must carry (the brand, when the brief makes it the
     subject) weighs what the offering does: the judge's first test is
     whether the opening says what is on offer. */
  const unnamed = plan.frames[0]
    ? unnamedOnHook(plan.frames[0], rules.offering, names).length
    : 0;
  return (
    problems +
    invented +
    faults +
    hook.length * (HOOK_WEIGHT - 1) +
    unnamed * (COVERAGE_WEIGHT - HOOK_WEIGHT)
  );
}

/**
 * How far a version of the hook is from standing, for choosing between
 * versions: the contract rules, invented claims and what is wrong with the
 * opening itself (an announcement, a label, an echo, a missing name).
 * Unlike planScore it leaves out the soft faults (a phrase another frame
 * shares, a later point previewed): round 3 measured code choosing on
 * those, and it kept preferring a flat label ("Cold brew at our Yaba
 * bar", judged 2) over a pull that shared a word with frame 2. Counting a
 * previewed point once was measured too (full-e: hook 4.11 to 3.94). What
 * is left tied goes to the editor, with every fault listed beside each
 * version, who weighs them as taste.
 */
export function hookScore(
  plan: PlannedSequence,
  {
    rules,
    ledger,
    names = [],
  }: { rules: SequenceRules; ledger: FactLedger; names?: readonly string[] },
): number {
  const hook = plan.frames[0];
  if (!hook) return 0;
  const problems = validateSequence(plan, rules).reduce(
    (n, p) => n + problemWeight(p),
    0,
  );
  const invented = plan.frames.reduce(
    (n, beat) => n + inventedOn(beat, ledger).length * MAJOR,
    0,
  );
  const brandName = rules.brandName ?? "";
  const faults = hookFaults(
    hook,
    rules.offering,
    names,
    brandName,
    rules.facts,
  );
  const unnamed = unnamedOnHook(hook, rules.offering, names).length;
  const priced = misplacedPrices(plan.frames, rules.facts, plan.kind).filter(
    (f) => f.frame === 0,
  ).length;
  return (
    problems +
    invented +
    (faults.length + priced) * HOOK_WEIGHT +
    unnamed * (COVERAGE_WEIGHT - HOOK_WEIGHT)
  );
}

/* A hook that gives no reason to swipe loses the whole set, a line said
   twice loses a frame: a hook version that trades the first for the second
   is kept, never the reverse. Below MAJOR, so no hook is worth a broken
   rule or an invented fact. */
const HOOK_WEIGHT = 2;

/** What is wrong with the hook beyond the contract (hook.ts): an
 *  announcement or a label, a subheadline echoing its headline, a name it
 *  must carry and does not, a later frame's point spent early. */
export function hookCopyFaults(
  frames: readonly FrameBeat[],
  offering: string | null,
  names: readonly string[] = [],
  brandName = "",
  facts: readonly BriefFact[] = [],
): FrameRepeat[] {
  const hook = frames[0];
  if (!hook) return [];
  return [
    ...hookFaults(hook, offering, names, brandName, facts),
    ...hookPreviews(frames, offering, brandName),
  ].map((detail) => ({ frame: 0, detail }));
}

/** What a rewrite can improve that is not a contract rule: a fact or
 *  phrase said twice (repeats.ts), a middle frame that is only a fact
 *  (points.ts), a hook that gives no reason to swipe (hook.ts). Drawable,
 *  so never fatal; asked for in the edit pass and counted against a
 *  rewrite. */
export function copyFaults(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  offering: string | null,
  names: readonly string[] = [],
  brandName = "",
  kind: SequenceKind = "presentation",
): FrameRepeat[] {
  return [
    ...sequenceRepeats(frames, facts, offering, brandName),
    ...factOnlyFrames(frames, facts),
    ...misplacedPrices(frames, facts, kind),
    ...hookCopyFaults(frames, offering, names, brandName, facts),
  ];
}

/** The prices a carousel states on a frame other than the last. */
export function misplacedFacts(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  kind: SequenceKind,
): BriefFact[] {
  if (kind !== "carousel") return [];
  return facts.filter(
    (f) =>
      f.kind === "price" &&
      frames.some((beat) => beat.role !== "cta" && statesPrice(f, beat)),
  );
}

/**
 * The edit pass's answers, kept frame by frame only where they leave the
 * set with fewer problems than before. A frame the editor's own review
 * named (`reviewed`) keeps a version that leaves no more problems than
 * before, since what it fixes (one point made twice in other words) is
 * what code cannot count; a version that breaks a rule, drops a fact or
 * adds a fault still loses. Code chooses between the model's answers; it
 * never writes a word of any.
 *
 * `linked` pairs frames whose fix is one move made on two frames (a price
 * leaving a middle frame for the action frame): each half alone scores
 * worse (the fact is dropped, or said twice), so one at a time neither is
 * ever kept. Each pair's versions are also tried together.
 */
export function applyRewrites(
  plan: PlannedSequence,
  rewrites: readonly FrameRewrite[],
  asked: ReadonlySet<number>,
  score: (plan: PlannedSequence) => number,
  reviewed: ReadonlySet<number> = new Set(),
  linked: readonly (readonly [number, number])[] = [],
): { plan: PlannedSequence; kept: number } {
  const changed = new Set<number>();
  let current = plan;
  let currentScore = score(plan);
  let kept = 0;
  for (const rewrite of rewrites) {
    const index = rewrite.frame - 1;
    if (!asked.has(index) || !current.frames[index]) continue;
    const frames = current.frames.map((beat, i) =>
      i === index ? withRewrite(beat, rewrite) : beat,
    );
    if (copyKey([frames[index]]) === copyKey([current.frames[index]])) {
      continue;
    }
    const candidate = { ...current, frames };
    const candidateScore = score(candidate);
    const firstForReviewed = reviewed.has(index) && !changed.has(index);
    if (
      candidateScore < currentScore ||
      (firstForReviewed && candidateScore === currentScore)
    ) {
      current = candidate;
      currentScore = candidateScore;
      changed.add(index);
      kept += 1;
    }
  }
  const versionsOf = (index: number) =>
    asked.has(index) ? rewrites.filter((r) => r.frame - 1 === index) : [];
  for (const [a, b] of linked) {
    if (!current.frames[a] || !current.frames[b]) continue;
    let best: { plan: PlannedSequence; score: number } | null = null;
    for (const va of versionsOf(a)) {
      for (const vb of versionsOf(b)) {
        const frames = current.frames.map((beat, i) => {
          if (i === a) return withRewrite(beat, va);
          return i === b ? withRewrite(beat, vb) : beat;
        });
        const candidate = { ...current, frames };
        const candidateScore = score(candidate);
        if (candidateScore < (best?.score ?? currentScore)) {
          best = { plan: candidate, score: candidateScore };
        }
      }
    }
    if (best) {
      current = best.plan;
      currentScore = best.score;
      kept += 2;
    }
  }
  return { plan: current, kept };
}

/** The frame pairs a carousel's misplaced price moves between: each
 *  frame before the last that states a price, with the last. */
export function priceMoves(
  plan: PlannedSequence,
  facts: readonly BriefFact[],
): [number, number][] {
  const last = plan.frames.length - 1;
  return misplacedPrices(plan.frames, facts, plan.kind)
    .map((f) => f.frame)
    .filter((frame, i, all) => all.indexOf(frame) === i)
    .map((frame) => [frame, last]);
}

/** The outline and its copy as one plan every frame of the set shares. */
export function assemblePlan(
  input: Pick<PlanSequenceInput, "kind" | "context">,
  brand: Pick<
    OutlineAnswer,
    | "palette"
    | "logoPlacement"
    | "logoFree"
    | "logoFreeQuote"
    | "backgroundTreatment"
    | "footerStyle"
  >,
  outline: OutlineSettlement,
  copy: CopyAnswer,
): PlannedSequence {
  const frames: FrameBeat[] = outline.frames.map((frame, i) => {
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

/**
 * The set's plan, outline first:
 *  1. The brief is read the way the directions path reads it
 *     (readBriefWithModel, settleBriefRead, sequenceFacts), so a set is
 *     held to the same facts a single design is.
 *  2. A small call lays out the arc: each frame's point, which facts it
 *     carries, its layout and the shared brand frame. Roles, coverage,
 *     the hook's image and layouts are settled in code (settleOutline);
 *     an outline making one point twice is asked for once more.
 *  3. COPY_DRAFTS calls, in parallel, write every frame's copy to that
 *     outline, and one goes on (choose.ts): the one with the fewest
 *     problems, else the editor's pick among those tied.
 *  4. The one repair pass, as an editor's read of the set
 *     (buildSequenceEditPrompt): the problems code found, by frame, the
 *     hook in HOOK_VERSIONS angles, and the editor's own review of which
 *     frames repeat another. A rewrite is kept only where it leaves fewer
 *     problems (or, on a frame the review named, no more); the hook's
 *     versions go through the same choice as the drafts.
 *  What stands is returned for the job to judge, and the copy faults no
 *  rewrite fixed with it (PlannedSequenceResult.faults). At most
 *  MAX_MODEL_CALLS calls, the brief read included.
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
  const hasLogo = Boolean(context.brand?.logoUrl);
  const hasImage = imageSource !== "none";
  const system = buildSequenceSystemPrompt(context.brandSummary, hasLogo, {
    memorySummary,
    recentLayouts: input.recentLayouts,
  });
  const briefText = context.briefText ?? "";
  const title = context.title ?? "";
  let modelCalls = 1;

  const raw = await briefReader({ briefText, title }).catch((err) => {
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
  const profile = profilePoints(context.brandSummary, briefText);
  const ownPoints = briefPoints(briefText, facts);
  const shared = contentStems(
    [context.brandSummary.name, offering].filter(Boolean).join(" "),
  );

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
     set, since seeing it only improves the copy. */
  async function ask<S extends z.ZodTypeAny>(
    schema: S,
    buildPrompt: (attached: boolean) => string,
    maxOutputTokens: number,
    count?: number,
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
    /* Once refused, the photograph is not sent again: each later call
       would otherwise pay for the refusal before asking without it. */
    if (!showImage || imageRefused) return once(false);
    try {
      const answer = await once(true);
      imageSeen = true;
      return answer;
    } catch (err) {
      if (err instanceof ModelBudgetError) throw err;
      console.error("sequence planner could not take the photograph", err);
      imageSeen = false;
      imageRefused = true;
      return once(false);
    }
  }

  const outlineOptions = {
    factCount: facts.length,
    offeringFact: offeringIndex >= 0 ? offeringIndex : null,
    hasImage,
    recentLayouts: input.recentLayouts,
    factKinds: facts.map((f) => f.kind),
    factTexts: facts.map((f) => f.text),
    profilePointCount: profile.length,
    briefPointCount: ownPoints.length,
    priceWithAction: kind === "carousel",
    whereWhenOffHook: kind === "carousel",
  };
  const askOutline = (repeated: string[], unsourced: string[] = []) =>
    ask(
      outlineResponseSchema(frameCount),
      (attached) =>
        buildOutlinePrompt(context, {
          kind,
          frameCount,
          aspectRatio,
          facts,
          offering,
          imageSource,
          imageAttached: attached,
          profilePoints: profile,
          briefPoints: ownPoints,
          repeated,
          unsourced,
        }),
      OUTLINE_MAX_OUTPUT_TOKENS,
      frameCount,
    );
  let outlineAnswer = await askOutline([]);
  let outline = settleOutline(outlineAnswer, outlineOptions);
  const repeatsIn = (settled: OutlineSettlement) => [
    ...new Set([
      ...repeatedPoints(settled.frames, shared),
      ...[...settled.profileReused, ...settled.briefReused].map(
        (i) => settled.frames[i].point,
      ),
    ]),
  ];
  const unsourcedIn = (settled: OutlineSettlement) =>
    settled.unsourced.map((i) => settled.frames[i].point);
  const outlineFaults = (settled: OutlineSettlement) =>
    repeatsIn(settled).length + unsourcedIn(settled).length;
  const repeated = repeatsIn(outline);
  const unsourced = unsourcedIn(outline);
  let outlineAskedAgain = false;
  if (repeated.length + unsourced.length > 0) {
    outlineAskedAgain = true;
    try {
      const again = await askOutline(repeated, unsourced);
      const settled = settleOutline(again, outlineOptions);
      if (outlineFaults(settled) < outlineFaults(outline)) {
        outlineAnswer = again;
        outline = settled;
      }
    } catch (err) {
      console.error("sequence outline re-ask failed; keeping the first", err);
    }
  }

  const askCopy = () =>
    ask(
      copyResponseSchema(frameCount),
      () =>
        buildFrameCopyPrompt(context, {
          kind,
          frames: outline.frames.map((frame) => ({
            ...frame,
            facts: frame.facts.map((n) => facts[n].text),
            profilePoint:
              frame.profilePoint === null
                ? null
                : profile[frame.profilePoint].text,
            briefPoint:
              frame.briefPoint === null ? null : ownPoints[frame.briefPoint],
          })),
          offering,
          imageSource,
          aspectRatio,
        }),
      COPY_MAX_OUTPUT_TOKENS,
      frameCount,
    );
  const written = await Promise.allSettled(
    Array.from({ length: COPY_DRAFTS }, askCopy),
  );
  const drafts = written.flatMap((w) =>
    w.status === "fulfilled"
      ? [assemblePlan({ kind, context }, outlineAnswer, outline, w.value)]
      : [],
  );
  if (drafts.length === 0) {
    throw (written[0] as PromiseRejectedResult).reason;
  }

  const rules: SequenceRules = {
    frameCount,
    facts,
    offering,
    hasImage,
    brandName,
  };
  const ledger = sequenceLedger(context, memorySummary);
  const factsByFrame = outline.frames.map((f) => f.facts);
  const score = (candidate: PlannedSequence) =>
    planScore(candidate, { rules, ledger, names });
  const tidied = (frames: readonly FrameBeat[]) =>
    withoutRepeats(frames, facts, offering, factsByFrame);
  const openingScore = (candidate: PlannedSequence) =>
    hookScore(candidate, { rules, ledger, names });

  const cleaned = drafts.map((draft) => ({
    ...draft,
    frames: tidied(draft.frames),
  }));
  /**
   * One of `options`: the only one lowest on `measure` (planScore unless
   * given), else the editor's pick among those tied, shown in a shuffled
   * order. The editor failing keeps the first of them.
   */
  async function editorChoice(
    options: readonly PlannedSequence[],
    buildPrompt: (shown: PlannedSequence[]) => string,
    measure: (option: PlannedSequence) => number = score,
  ): Promise<EditorChoice> {
    const scores = options.map(measure);
    const tied = distinctCopy(options, leastProblems(scores));
    if (tied.length === 1) return { index: tied[0], by: "code", scores };
    const order = shownOrder(tied.length);
    const shown = order.map((i) => options[tied[i]]);
    try {
      const answer = await ask(
        choiceResponseSchema(tied.length),
        () => buildPrompt(shown),
        CHOICE_MAX_OUTPUT_TOKENS,
      );
      return {
        index: tied[chosenIndex(answer.choice, order)],
        by: "editor",
        scores,
        why: answer.why,
      };
    } catch (err) {
      console.error("sequence editor choice failed; keeping the first", err);
      return { index: tied[0], by: "fallback", scores };
    }
  }

  const choice = await editorChoice(cleaned, (shown) =>
    buildSequenceChoicePrompt(context, {
      kind,
      drafts: shown.map((d) => d.frames),
    }),
  );
  const draft = cleaned[choice.index];
  let plan = draft;
  const fixes = repairFixes(plan, validateSequence(plan, rules), {
    facts,
    factsByFrame,
    ledger,
    offering,
    names,
    brandName,
  });
  const hookAsked = fixes.find((f) => f.index === 0)?.problems ?? [];
  const bodyFixes = fixes.filter((f) => f.index !== 0);
  let review: EditAnswer["review"] = [];
  let kept = 0;
  let hook: EditorChoice | null = null;
  try {
    const answer = await ask(
      editResponseSchema,
      () =>
        buildSequenceEditPrompt(context, {
          kind,
          frames: plan.frames,
          fixes: bodyFixes,
          hookProblems: hookAsked,
          mustState: factsByFrame.map((owned) =>
            owned.map((n) => facts[n].text),
          ),
          names,
          spareProfilePoints: profile.filter(
            (_, n) => !outline.frames.some((f) => f.profilePoint === n),
          ),
        }),
      COPY_MAX_OUTPUT_TOKENS,
    );
    review = answer.review.filter(
      (note) => note.frame >= 2 && note.frame <= frameCount,
    );
    const reviewed = new Set(review.map((note) => note.frame - 1));
    const moves = priceMoves(plan, facts);
    const applied = applyRewrites(
      plan,
      answer.frames.filter((rewrite) => rewrite.frame !== 1),
      new Set([...bodyFixes.map((f) => f.index), ...reviewed]),
      score,
      reviewed,
      moves.filter(([from]) => from !== 0),
    );
    kept = applied.kept;
    const current = { ...applied.plan, frames: tidied(applied.plan.frames) };
    plan = current;
    const last = frameCount - 1;
    /* A price on the hook moves to the action frame in the same choice:
       a hook version that drops it alone leaves the set without it. */
    const actionVersions = moves.some(([from]) => from === 0)
      ? answer.frames.filter((rewrite) => rewrite.frame === frameCount)
      : [];
    const hookWith = (v: FrameRewrite, action: FrameRewrite | null) => ({
      ...current,
      frames: tidied(
        current.frames.map((beat, i) => {
          if (i === 0) return { ...withRewrite(beat, v), title: beat.title };
          return i === last && action ? withRewrite(beat, action) : beat;
        }),
      ),
    });
    const hookVersions = answer.frames
      .filter((rewrite) => rewrite.frame === 1)
      .slice(0, HOOK_VERSIONS);
    const versions = [
      current,
      ...hookVersions.map((v) => hookWith(v, null)),
      ...hookVersions.flatMap((v) =>
        actionVersions.map((action) => hookWith(v, action)),
      ),
    ];
    if (versions.length > 1) {
      hook = await editorChoice(
        versions,
        (shown) =>
          buildHookChoicePrompt(context, {
            kind,
            frames: current.frames,
            hooks: shown.map((v) => v.frames[0]),
            faults: shown.map((v) =>
              hookCopyFaults(v.frames, offering, names, brandName, facts).map(
                (f) => f.detail,
              ),
            ),
          }),
        openingScore,
      );
      plan = versions[hook.index];
    }
  } catch (err) {
    console.error("sequence edit pass failed; keeping the draft", err);
  }

  const filled = withFactsDrawn(plan, facts, factsByFrame);
  plan = { ...filled.plan, frames: filled.plan.frames.map(withFigureLayout) };
  const problems = validateSequence(plan, rules);
  const invented = plan.frames.flatMap((beat, frame) =>
    inventedOn(beat, ledger).map((text) => ({ frame, text })),
  );
  const faults = copyFaults(
    plan.frames,
    facts,
    offering,
    names,
    brandName,
    kind,
  );
  console.info("design.sequence.planned", {
    kind,
    frames: frameCount,
    facts: facts.length,
    factsPlaced: outline.factsPlaced.length,
    profilePoints: profile.length,
    profilePointsUsed: outline.frames.filter((f) => f.profilePoint !== null)
      .length,
    briefPoints: ownPoints.length,
    briefPointsUsed: outline.frames.filter((f) => f.briefPoint !== null).length,
    unsourced: outline.unsourced.length,
    layoutsChanged: outline.layoutsChanged,
    outlineAskedAgain,
    drafts: drafts.length,
    draft: choice,
    repairAsked: fixes.length,
    review,
    rewritesKept: kept,
    hookAsked,
    hook,
    problems: problems.map((p) => p.rule),
    invented,
    factsDrawn: filled.drawn,
    faults: faults.map((f) => f.detail),
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
    faults,
    invented,
    factsDrawn: filled.drawn,
    modelCalls,
    repaired: copyKey(plan.frames) !== copyKey(draft.frames),
  };
}
