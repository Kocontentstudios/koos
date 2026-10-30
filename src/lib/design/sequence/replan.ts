import { generateObject } from "ai";
import {
  buildFrameRegeneratePrompt,
  buildSequenceSystemPrompt,
  hookNames,
  REGENERATE_VERSIONS,
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
import { hookFaults, hookPreviews } from "./hook";
import { inventedOn, sequenceFacts, sequenceLedger, withRewrite } from "./plan";
import { repairSequenceFor } from "./repair";
import { type FrameRewrite, rewriteResponseSchema } from "./schema";
import {
  copyLimitProblems,
  factsUncovered,
  frameCopy,
  roleProblems,
} from "./validate";

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

/** What kept a version out, in the user's terms: the problems are
 *  written for the model ("it states "one", which the brief does not
 *  give"), and a refused paid regenerate should say why (round-2 critic,
 *  finding 8). */
export function replanReason(problems: readonly string[]): string | null {
  const first = problems[0]?.trim();
  if (!first) return null;
  return first.replace(/^it\b/, "the new version");
}

/** A model rewrite none of whose versions could stand beside its set.
 *  The frame on show is kept. */
export class FrameReplanError extends Error {
  constructor(readonly problems: string[]) {
    const reason = replanReason(problems);
    super(
      `KO couldn't write a different version of this frame that fits the rest of the set${reason ? `: ${reason}` : ""}. The frame is unchanged; try again or edit its words.`,
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
 *  fact the set stated that it no longer does, an invented fact, a set
 *  left without its one button, or a hook that stopped naming the
 *  offering or gives no reason to swipe (hookFaults, and a later frame's
 *  point it now spends). */
export function regenerateProblems(
  plan: PlannedSequence,
  index: number,
  next: FrameBeat,
  {
    facts,
    offering,
    invented,
    brandName,
    names = [],
  }: {
    facts: readonly BriefFact[];
    offering: string | null;
    invented: string[];
    brandName: string;
    /** What the hook names (hookNames). */
    names?: readonly string[];
  },
): string[] {
  const before = plan.frames[index];
  const frames = plan.frames.map((beat, i) => (i === index ? next : beat));
  const roleBefore = new Set(roleProblems(plan.frames).map((p) => p.detail));
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
  for (const role of roleProblems(frames)) {
    if (!roleBefore.has(role.detail)) problems.push(role.detail);
  }
  if (index === 0) {
    problems.push(...hookFaults(next, offering, names, brandName, facts));
    const previewed = new Set(hookPreviews(plan.frames, offering, brandName));
    for (const preview of hookPreviews(frames, offering, brandName)) {
      if (!previewed.has(preview)) problems.push(preview);
    }
  }
  return problems;
}

export interface ReplanFrameDeps {
  /** The facts and offering the set was planned and checked against
   *  (PlanSequenceResult). Given, the frame is held to exactly those; the
   *  brief is read again only when they are absent, since a second read
   *  can return a different list than the set was planned with. */
  facts?: readonly BriefFact[];
  offering?: string | null;
  briefReader?: BriefReader;
}

/** The facts and offering a frame's rewrite is held to, with the model
 *  calls it took to get them. */
async function heldTo(
  context: ReplanFrameInput["context"],
  { facts, offering, briefReader = readBriefWithModel }: ReplanFrameDeps,
): Promise<{
  facts: readonly BriefFact[];
  offering: string | null;
  calls: number;
}> {
  if (facts !== undefined) {
    return { facts, offering: offering ?? null, calls: 0 };
  }
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
  return {
    facts: sequenceFacts(read, context.brandSummary.name),
    offering:
      offering !== undefined ? offering : (read.offering?.phrase ?? null),
    calls: 1,
  };
}

/** A new beat for one frame of an existing plan: the user's edits as
 *  written, or one model call for REGENERATE_VERSIONS versions of the
 *  frame, of which code keeps the first that stands beside its set. */
export async function replanFrame(
  { context, plan, index, edits }: ReplanFrameInput,
  deps: ReplanFrameDeps = {},
): Promise<{ beat: FrameBeat; modelCalls: number }> {
  const beat = plan.frames[index];
  if (!beat) {
    throw new RangeError(
      `replanFrame: frame ${index} is outside a ${plan.frames.length}-frame set`,
    );
  }
  if (edits) return { beat: applyFrameEdits(beat, edits), modelCalls: 0 };

  const held = await heldTo(context, deps);
  const { facts, offering } = held;
  let modelCalls = held.calls;
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

  const askVersions = async (): Promise<FrameRewrite[]> => {
    modelCalls += 1;
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema: rewriteResponseSchema,
      system,
      maxOutputTokens: 2000,
      experimental_repairText: repairSequenceFor(),
      prompt: buildFrameRegeneratePrompt(context, {
        kind: plan.kind,
        frames: plan.frames,
        index,
        mustState,
        offering,
      }),
    });
    const own = object.frames.filter((f) => f.frame === index + 1);
    return own.length > 0 ? own : object.frames;
  };

  const judge = (rewrite: FrameRewrite) => {
    /* Same point, so the same title on its card. */
    const next = { ...withRewrite(beat, rewrite), title: beat.title };
    return {
      next,
      problems: regenerateProblems(plan, index, next, {
        facts,
        offering,
        invented: inventedOn(next, ledger),
        brandName: context.brandSummary.name,
        names: hookNames(context, offering),
      }),
    };
  };

  const versions = (await askVersions())
    .slice(0, REGENERATE_VERSIONS)
    .map(judge);
  const usable = versions.find((v) => v.problems.length === 0);
  console.info("design.sequence.frame_replanned", {
    index,
    versions: versions.length,
    kept: usable ? versions.indexOf(usable) : null,
    problems: versions.map((v) => v.problems),
    readBrief: held.calls > 0,
    modelCalls,
  });
  if (usable) return { beat: usable.next, modelCalls };
  throw new FrameReplanError(
    versions.length > 0
      ? versions[versions.length - 1].problems
      : ["no frame came back"],
  );
}
