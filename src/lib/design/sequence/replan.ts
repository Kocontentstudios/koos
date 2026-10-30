import { generateObject } from "ai";
import {
  buildFrameRegeneratePrompt,
  buildSequenceSystemPrompt,
} from "@/lib/ai/prompts/design-sequence";
import { getModel } from "@/lib/ai/provider";
import { brandFacts } from "@/lib/jobs/directions/brief";
import {
  type BriefFact,
  brandRegion,
  factStated,
} from "@/lib/jobs/directions/brief-facts";
import {
  type BriefReader,
  coverFactsOf,
  readBriefWithModel,
  settleBriefRead,
} from "@/lib/jobs/directions/brief-read";
import { copyNamesOffering } from "@/lib/jobs/directions/finalize";
import { COPY_LIMITS } from "@/lib/jobs/directions/schema";
import {
  contentStems,
  isNearDuplicateHeadline,
} from "@/lib/jobs/directions/text-overlap";
import type {
  FrameBeat,
  FrameEdits,
  PlannedSequence,
  ReplanFrameInput,
} from "./contract";
import { inventedOn, sequenceLedger, withRewrite } from "./plan";
import { type FrameRewrite, rewriteResponseSchema } from "./schema";
import { copyLimitProblems, factsUncovered, frameCopy } from "./validate";

/** A user's edit that cannot be drawn. The message is shown to them as is. */
export class FrameEditError extends Error {
  constructor(
    message: string,
    readonly field: keyof FrameEdits,
  ) {
    super(message);
    this.name = "FrameEditError";
  }
}

/** A model rewrite that, asked twice, still could not stand beside its
 *  set. The frame on show is kept. */
export class FrameReplanError extends Error {
  constructor(readonly problems: string[]) {
    super(
      "KO couldn't write a different version of this frame that fits the rest of the set. The frame is unchanged; try again or edit its words.",
    );
    this.name = "FrameReplanError";
  }
}

const FIELD_NAMES: Record<keyof FrameEdits, string> = {
  headline: "headline",
  subheadline: "subheadline",
  cta: "button text",
};

/* Whitespace at either end is never drawn, so trimming it changes no word
   the user typed. */
function edited(
  field: keyof FrameEdits,
  value: string | undefined,
  current: string,
): string {
  if (value === undefined) return current;
  const text = value.trim();
  const limit = COPY_LIMITS[field];
  if (text.length > limit) {
    throw new FrameEditError(
      `The ${FIELD_NAMES[field]} is ${text.length} characters; a frame fits ${limit}. Shorten it by ${text.length - limit}.`,
      field,
    );
  }
  return text;
}

/**
 * The frame with the user's words as typed: no model call and no rewrite
 * (H9). Role, layout, image and footer stay. Refused, with a reason the
 * user can act on, only when the words cannot be drawn: past a limit, an
 * empty headline, a button on a frame that is not the last, or the last
 * frame left without one.
 */
export function applyFrameEdits(beat: FrameBeat, edits: FrameEdits): FrameBeat {
  const headline = edited("headline", edits.headline, beat.headline);
  if (!headline) {
    throw new FrameEditError("Every frame needs a headline.", "headline");
  }
  const subheadline = edited(
    "subheadline",
    edits.subheadline,
    beat.subheadline,
  );
  const cta = edited("cta", edits.cta, beat.cta);
  if (beat.role !== "cta" && cta) {
    throw new FrameEditError(
      "Only the last frame carries a button. Put the action there.",
      "cta",
    );
  }
  if (beat.role === "cta" && !cta) {
    throw new FrameEditError(
      "The last frame needs its button text: it is where the viewer acts.",
      "cta",
    );
  }
  return { ...beat, headline, subheadline, cta };
}

/** What stops a rewritten frame standing beside its set: a limit, a
 *  headline another frame (or the frame it replaces) already says, a brief
 *  fact the set stated that it no longer does, an invented fact, or a hook
 *  that stopped naming the offering. */
export function regenerateProblems(
  plan: PlannedSequence,
  index: number,
  next: FrameBeat,
  {
    facts,
    offering,
    invented,
    brandName,
  }: {
    facts: readonly BriefFact[];
    offering: string | null;
    invented: string[];
    brandName: string;
  },
): string[] {
  const before = plan.frames[index];
  const frames = plan.frames.map((beat, i) => (i === index ? next : beat));
  const ignore = contentStems(brandName);
  /* Hard limits only: a headline a word over the format's budget is still
     drawn, and failing a paid regenerate over it would cost the user more
     than the word does. */
  const problems = copyLimitProblems(next, index, plan.kind, {
    budget: false,
  }).map((p) => p.detail);
  if (isNearDuplicateHeadline(before.headline, next.headline, ignore)) {
    problems.push(`the headline "${next.headline}" says what it said before`);
  }
  plan.frames.forEach((beat, i) => {
    if (
      i !== index &&
      isNearDuplicateHeadline(beat.headline, next.headline, ignore)
    ) {
      problems.push(
        `the headline "${next.headline}" says what frame ${i + 1}'s "${beat.headline}" says`,
      );
    }
  });
  const wasUncovered = new Set(factsUncovered(plan.frames, facts));
  for (const fact of factsUncovered(frames, facts)) {
    if (!wasUncovered.has(fact)) {
      problems.push(`it no longer states "${fact.text}"`);
    }
  }
  if (
    index === 0 &&
    offering &&
    !copyNamesOffering(next, offering) &&
    copyNamesOffering(before, offering)
  ) {
    problems.push(`the hook no longer names "${offering}"`);
  }
  for (const made of invented) {
    problems.push(`it states "${made}", which the brief does not give`);
  }
  return problems;
}

export interface ReplanFrameDeps {
  briefReader?: BriefReader;
}

/** A new beat for one frame of an existing plan: the user's edits as
 *  written, or a model rewrite distinct from its neighbours. */
export async function replanFrame(
  { context, plan, index, edits }: ReplanFrameInput,
  { briefReader = readBriefWithModel }: ReplanFrameDeps = {},
): Promise<{ beat: FrameBeat; modelCalls: number }> {
  const beat = plan.frames[index];
  if (!beat) {
    throw new RangeError(
      `replanFrame: frame ${index} is outside a ${plan.frames.length}-frame set`,
    );
  }
  if (edits) return { beat: applyFrameEdits(beat, edits), modelCalls: 0 };

  const briefText = context.briefText ?? "";
  const raw = await briefReader({
    briefText,
    title: context.title ?? "",
  }).catch((err) => {
    console.error("frame regenerate brief read failed", err);
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
  let modelCalls = 1;
  const system = buildSequenceSystemPrompt(
    context.brandSummary,
    Boolean(context.brand?.logoUrl),
  );
  const ledger = sequenceLedger(context, "");

  /* Only the facts this frame states alone are its to keep: one stated on
     another frame too is still on the set if this frame drops it. */
  const mustState = facts
    .filter((fact) => factStated(fact, frameCopy(beat)))
    .filter(
      (fact) =>
        !plan.frames.some(
          (other, i) => i !== index && factStated(fact, frameCopy(other)),
        ),
    )
    .map((fact) => fact.text);

  const askRewrite = async (
    problems: string[],
  ): Promise<FrameRewrite | null> => {
    modelCalls += 1;
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema: rewriteResponseSchema,
      system,
      maxOutputTokens: 2000,
      prompt: buildFrameRegeneratePrompt(context, {
        kind: plan.kind,
        frames: plan.frames,
        index,
        mustState,
        offering,
        problems,
      }),
    });
    return (
      object.frames.find((f) => f.frame === index + 1) ??
      object.frames[0] ??
      null
    );
  };

  const judge = (rewrite: FrameRewrite | null) => {
    if (!rewrite) return { next: null, problems: ["no frame came back"] };
    /* Same point, so the same title on its card. */
    const next = { ...withRewrite(beat, rewrite), title: beat.title };
    return {
      next,
      problems: regenerateProblems(plan, index, next, {
        facts,
        offering,
        invented: inventedOn(next, ledger),
        brandName: context.brandSummary.name,
      }),
    };
  };

  const attempt = judge(await askRewrite([]));
  if (attempt.next && attempt.problems.length === 0) {
    return { beat: attempt.next, modelCalls };
  }
  const second = judge(await askRewrite(attempt.problems));
  if (second.next && second.problems.length === 0) {
    return { beat: second.next, modelCalls };
  }
  console.error("design.sequence.frame_replan_refused", {
    index,
    first: attempt.problems,
    second: second.problems,
  });
  throw new FrameReplanError(second.problems);
}
