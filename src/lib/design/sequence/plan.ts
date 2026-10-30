import { generateObject } from "ai";
import type { z } from "zod";
import {
  buildFrameCopyPrompt,
  buildHookChoicePrompt,
  buildHookRewritePrompt,
  buildOutlinePrompt,
  buildSequenceChoicePrompt,
  buildSequenceRepairPrompt,
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
  type FrameBeat,
  type PlannedSequence,
  type PlanSequenceInput,
  type PlanSequenceResult,
  PRESENTATION_ASPECT,
  type SequenceProblem,
} from "./contract";
import { hookFaults, hookPreviews } from "./hook";
import {
  type OutlineSettlement,
  repeatedPoints,
  settleOutline,
} from "./outline";
import { repairSequenceFor } from "./repair";
import { type FrameRepeat, sequenceRepeats, withoutRepeats } from "./repeats";
import {
  type CopyAnswer,
  copyResponseSchema,
  type FrameRewrite,
  type OutlineAnswer,
  outlineResponseSchema,
  rewriteResponseSchema,
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
const HOOK_MAX_OUTPUT_TOKENS = 2000;
const CHOICE_MAX_OUTPUT_TOKENS = 600;

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

/** What the brief and brand vouch for, as the directions path builds it:
 *  the brief and its title first, then the brand profile and memory. */
export function sequenceLedger(
  context: DesignContext,
  memorySummary: string,
): FactLedger {
  return factLedger(
    [
      context.briefText,
      context.title,
      ...brandFacts(context.brandSummary),
      memorySummary,
    ],
    2,
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
  )) {
    add(repeat.frame, repeat.detail);
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
  return {
    ...beat,
    title: rewrite.title.trim(),
    headline: rewrite.headline.trim(),
    subheadline: rewrite.subheadline.trim(),
    cta: beat.role === "cta" ? rewrite.cta.trim() : "",
    footerLines: tidyLines(rewrite.footerLines),
  };
}

/* A frame that cannot be drawn, misses a fact or says a neighbour's
   headline costs more than one a word over its budget or with a phrase said
   twice: a rewrite that trades the first for the second is an
   improvement, never the reverse. */
const MAJOR = 3;

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
    (n, p) => n + (isWordBudgetProblem(p) ? 1 : MAJOR),
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
  ).length;
  const hook = hookCopyFaults(plan.frames, rules.offering, names, brandName);
  return problems + invented + faults + hook.length * (HOOK_WEIGHT - 1);
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
): FrameRepeat[] {
  const hook = frames[0];
  if (!hook) return [];
  return [
    ...hookFaults(hook, offering, names, brandName),
    ...hookPreviews(frames, offering, brandName),
  ].map((detail) => ({ frame: 0, detail }));
}

/** What a rewrite can improve that is not a contract rule: a fact or
 *  phrase said twice (repeats.ts), a hook that gives no reason to swipe
 *  (hook.ts). Drawable, so never fatal; asked for in the repair pass and
 *  counted against a rewrite. */
export function copyFaults(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  offering: string | null,
  names: readonly string[] = [],
  brandName = "",
): FrameRepeat[] {
  return [
    ...sequenceRepeats(frames, facts, offering, brandName),
    ...hookCopyFaults(frames, offering, names, brandName),
  ];
}

/**
 * The one repair pass's answers, kept frame by frame only where they leave
 * the set with fewer problems than before. Code chooses between the
 * model's two answers; it never writes a word of either.
 */
export function applyRewrites(
  plan: PlannedSequence,
  rewrites: readonly FrameRewrite[],
  asked: ReadonlySet<number>,
  score: (plan: PlannedSequence) => number,
): { plan: PlannedSequence; kept: number } {
  let current = plan;
  let currentScore = score(plan);
  let kept = 0;
  for (const rewrite of rewrites) {
    const index = rewrite.frame - 1;
    if (!asked.has(index) || !current.frames[index]) continue;
    const frames = current.frames.map((beat, i) =>
      i === index ? withRewrite(beat, rewrite) : beat,
    );
    const candidate = { ...current, frames };
    const candidateScore = score(candidate);
    if (candidateScore < currentScore) {
      current = candidate;
      currentScore = candidateScore;
      kept += 1;
    }
  }
  return { plan: current, kept };
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
 *  4. validateSequence and the copy checks name what to fix, and the
 *     frames named are asked for once. A rewrite is kept only where it
 *     leaves fewer problems.
 *  5. The hook is written again on its own, in HOOK_VERSIONS angles, told
 *     what code finds wrong with it (hookCopyFaults); it and its versions
 *     go through the same choice as the drafts.
 *  What stands is returned for the job to judge, and the copy faults no
 *  rewrite fixed with it (PlannedSequenceResult.faults).
 */
export async function planSequence(
  input: PlanSequenceInput,
  { briefReader = readBriefWithModel }: PlanSequenceDeps = {},
): Promise<PlannedSequenceResult> {
  const { context, kind, frameCount, imageSource, image } = input;
  if (!Number.isInteger(frameCount) || frameCount < 2) {
    throw new RangeError(`planSequence: ${frameCount} is not a frame count`);
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
  const shared = contentStems(
    [context.brandSummary.name, offering].filter(Boolean).join(" "),
  );

  const showImage =
    imageSource === "upload" &&
    image !== null &&
    image.bytes.byteLength <= ART_DIRECTOR_IMAGE_MAX_BYTES;
  let imageSeen = false;

  async function askOnce<S extends z.ZodTypeAny>(
    schema: S,
    prompt: string,
    withImage: boolean,
    maxOutputTokens: number,
    count: number | undefined,
  ): Promise<z.infer<S>> {
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
    if (!showImage) return once(false);
    try {
      const answer = await once(true);
      imageSeen = true;
      return answer;
    } catch (err) {
      console.error("sequence planner could not take the photograph", err);
      imageSeen = false;
      return once(false);
    }
  }

  const outlineOptions = {
    factCount: facts.length,
    offeringFact: offeringIndex >= 0 ? offeringIndex : null,
    hasImage,
    recentLayouts: input.recentLayouts,
    factKinds: facts.map((f) => f.kind),
  };
  const askOutline = (repeated: string[]) =>
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
          repeated,
        }),
      OUTLINE_MAX_OUTPUT_TOKENS,
      frameCount,
    );
  let outlineAnswer = await askOutline([]);
  let outline = settleOutline(outlineAnswer, outlineOptions);
  const repeated = repeatedPoints(outline.frames, shared);
  let outlineAskedAgain = false;
  if (repeated.length > 0) {
    outlineAskedAgain = true;
    try {
      const again = await askOutline(repeated);
      const settled = settleOutline(again, outlineOptions);
      if (repeatedPoints(settled.frames, shared).length < repeated.length) {
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

  const cleaned = drafts.map((draft) => ({
    ...draft,
    frames: withoutRepeats(draft.frames, facts, offering),
  }));
  /**
   * One of `options`: the only one with the fewest problems, else the
   * editor's pick among those tied for fewest, shown in a shuffled order.
   * The editor failing keeps the first of them.
   */
  async function editorChoice(
    options: readonly PlannedSequence[],
    buildPrompt: (shown: PlannedSequence[]) => string,
  ): Promise<EditorChoice> {
    const scores = options.map(score);
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
  let plan = cleaned[choice.index];
  const fixes = repairFixes(plan, validateSequence(plan, rules), {
    facts,
    factsByFrame,
    ledger,
    offering,
    names,
    brandName,
  });
  let repaired = false;
  if (fixes.length > 0) {
    try {
      const answer = await ask(
        rewriteResponseSchema,
        () =>
          buildSequenceRepairPrompt(context, {
            kind,
            frames: plan.frames,
            fixes,
          }),
        COPY_MAX_OUTPUT_TOKENS,
      );
      const applied = applyRewrites(
        plan,
        answer.frames,
        new Set(fixes.map((f) => f.index)),
        score,
      );
      plan = {
        ...applied.plan,
        frames: withoutRepeats(applied.plan.frames, facts, offering),
      };
      repaired = applied.kept > 0;
    } catch (err) {
      console.error("sequence repair pass failed; keeping the first copy", err);
    }
  }

  const hookProblems = () => [
    ...validateSequence(plan, rules)
      .filter((p) => p.frame === 0 && p.rule === "offering-unnamed")
      .map((p) => p.detail),
    ...hookCopyFaults(plan.frames, offering, names, brandName).map(
      (f) => f.detail,
    ),
  ];
  /* Always asked, not only when code finds a fault: the opening decides
     whether anyone sees the rest, and a hook with no fault code can name
     can still be flat (round 2: "Send an invoice in seconds", hook 2/5). */
  const hookAsked = hookProblems();
  const hookBefore = copyKey([plan.frames[0]]);
  let hook: EditorChoice | null = null;
  try {
    const answer = await ask(
      rewriteResponseSchema,
      () =>
        buildHookRewritePrompt(context, {
          kind,
          frames: plan.frames,
          problems: hookAsked,
          mustState: (factsByFrame[0] ?? []).map((n) => facts[n].text),
          names,
        }),
      HOOK_MAX_OUTPUT_TOKENS,
    );
    const current = plan;
    const versions = [
      current,
      ...answer.frames.slice(0, HOOK_VERSIONS).map((v) => ({
        ...current,
        frames: withoutRepeats(
          current.frames.map((beat, i) =>
            i === 0
              ? { ...withRewrite(beat, { ...v, frame: 1 }), title: beat.title }
              : beat,
          ),
          facts,
          offering,
        ),
      })),
    ];
    hook = await editorChoice(versions, (shown) =>
      buildHookChoicePrompt(context, {
        kind,
        frames: current.frames,
        hooks: shown.map((v) => v.frames[0]),
      }),
    );
    plan = versions[hook.index];
  } catch (err) {
    console.error("sequence hook versions failed; keeping the hook", err);
  }

  const problems = validateSequence(plan, rules);
  const invented = plan.frames.flatMap((beat, frame) =>
    inventedOn(beat, ledger).map((text) => ({ frame, text })),
  );
  const faults = copyFaults(plan.frames, facts, offering, names, brandName);
  console.info("design.sequence.planned", {
    kind,
    frames: frameCount,
    facts: facts.length,
    factsPlaced: outline.factsPlaced.length,
    layoutsChanged: outline.layoutsChanged,
    outlineAskedAgain,
    drafts: drafts.length,
    draft: choice,
    repairAsked: fixes.length,
    repaired,
    hookAsked,
    hook,
    problems: problems.map((p) => p.rule),
    invented,
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
    modelCalls,
    repaired: repaired || copyKey([plan.frames[0]]) !== hookBefore,
  };
}
