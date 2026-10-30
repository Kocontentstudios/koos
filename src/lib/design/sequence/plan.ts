import { generateObject } from "ai";
import type { z } from "zod";
import {
  buildFrameCopyPrompt,
  buildOutlinePrompt,
  buildSequenceRepairPrompt,
  buildSequenceSystemPrompt,
  type FrameFix,
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
  type FrameBeat,
  type PlannedSequence,
  type PlanSequenceInput,
  type PlanSequenceResult,
  PRESENTATION_ASPECT,
  type SequenceProblem,
} from "./contract";
import { hookFaults } from "./hook";
import {
  type OutlineSettlement,
  repeatedPoints,
  settleOutline,
} from "./outline";
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

export interface PlanSequenceDeps {
  /** Reads the brief's facts, offering and people (brief-read.ts). */
  briefReader?: BriefReader;
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
  }: {
    facts: readonly BriefFact[];
    /** Zero-based fact indexes each frame was planned to state. */
    factsByFrame: readonly number[][];
    ledger: FactLedger;
    offering: string | null;
    /** What the hook must name (hookNames). */
    names?: readonly string[];
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
  for (const repeat of copyFaults(plan.frames, facts, offering, names)) {
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
  const faults = copyFaults(
    plan.frames,
    rules.facts,
    rules.offering,
    names,
  ).length;
  return problems + invented + faults;
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
): FrameRepeat[] {
  const hook = frames[0];
  return [
    ...sequenceRepeats(frames, facts, offering),
    ...(hook
      ? hookFaults(hook, offering, names).map((detail) => ({
          frame: 0,
          detail,
        }))
      : []),
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
 *     (readBriefWithModel, settleBriefRead, coverFactsOf), so a set is held
 *     to the same facts a single design is.
 *  2. A small call lays out the arc: each frame's point, which facts it
 *     carries, its layout and the shared brand frame. Roles, coverage,
 *     the hook's image and layouts are settled in code (settleOutline);
 *     an outline making one point twice is asked for once more.
 *  3. One call writes every frame's copy to that outline.
 *  4. validateSequence names what still breaks a rule; the frames whose
 *     problem a rewrite can fix are asked for once, and a rewrite is kept only
 *     where it leaves fewer problems. What stands is returned for the job
 *     to judge.
 */
export async function planSequence(
  input: PlanSequenceInput,
  { briefReader = readBriefWithModel }: PlanSequenceDeps = {},
): Promise<PlanSequenceResult> {
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
  const facts = coverFactsOf(read);
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
  ): Promise<z.infer<S>> {
    modelCalls += 1;
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema,
      system,
      maxOutputTokens,
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
  ): Promise<z.infer<S>> {
    const once = async (withImage: boolean) => {
      try {
        return await askOnce(
          schema,
          buildPrompt(withImage),
          withImage,
          maxOutputTokens,
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

  const copy = await ask(
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
  );
  let plan = assemblePlan({ kind, context }, outlineAnswer, outline, copy);

  const rules: SequenceRules = {
    frameCount,
    facts,
    offering,
    hasImage,
    brandName: context.brandSummary.name,
  };
  const ledger = sequenceLedger(context, memorySummary);
  const factsByFrame = outline.frames.map((f) => f.facts);
  const score = (candidate: PlannedSequence) =>
    planScore(candidate, { rules, ledger, names });

  plan = { ...plan, frames: withoutRepeats(plan.frames, facts, offering) };
  const fixes = repairFixes(plan, validateSequence(plan, rules), {
    facts,
    factsByFrame,
    ledger,
    offering,
    names,
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

  const problems = validateSequence(plan, rules);
  const invented = plan.frames.flatMap((beat, frame) =>
    inventedOn(beat, ledger).map((text) => ({ frame, text })),
  );
  const faults = copyFaults(plan.frames, facts, offering, names);
  console.info("design.sequence.planned", {
    kind,
    frames: frameCount,
    facts: facts.length,
    factsPlaced: outline.factsPlaced.length,
    layoutsChanged: outline.layoutsChanged,
    outlineAskedAgain,
    repairAsked: fixes.length,
    repaired,
    problems: problems.map((p) => p.rule),
    invented,
    faults: faults.map((f) => f.detail),
    imageSeen,
    readAvailable: read.available,
    modelCalls,
    ms: Date.now() - started,
  });
  return { plan, facts, offering, problems, modelCalls, repaired };
}
