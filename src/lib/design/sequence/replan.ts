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
import { withRewrite } from "./fixes";
import { hookFaults, hookPreviews } from "./hook";
import { withFigureLayout } from "./layouts";
import { inventedOn, sequenceFacts, sequenceLedger } from "./ledger";
import { misplacedPrices } from "./points";
import { repairSequenceFor } from "./repair";
import { factsTwiceInFrame, withoutRepeats } from "./repeats";
import { type FrameRewrite, rewriteResponseSchema } from "./schema";
import { settledTitle } from "./title";
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

/** Why a regenerated version cannot stand, by kind. The detail is
 *  written for the model and the logs; the user is told the kind. */
export type RegenerateProblemKind =
  | "too-long"
  | "same-as-before"
  | "repeats-frame"
  | "drops-fact"
  | "drops-offering"
  | "invented"
  | "role"
  | "flat-hook"
  | "hook-preview"
  | "price-placement"
  | "fact-twice"
  | "nothing-back";

export interface RegenerateProblem {
  kind: RegenerateProblemKind;
  detail: string;
}

/* A refused paid regenerate says why, in a sentence for the person who
   pressed the button, never the instruction the model was given. Each
   reason completes "Every new version ..." or "One new version ...". */
const USER_REASON: Record<RegenerateProblemKind, string> = {
  "too-long": "was too long to fit",
  "same-as-before": "said what it says now",
  "repeats-frame": "repeated another frame's headline",
  "drops-fact": "left out a detail only this frame gives",
  "drops-offering": "stopped saying what is on offer",
  invented: "added a detail neither the brief nor the brand profile gives",
  role: "broke this frame's job in the set",
  "flat-hook": "was a label, not a reason to swipe",
  "hook-preview": "gave away a later frame's point",
  "price-placement": "moved the price off the last frame",
  "fact-twice": "gave the same detail twice",
  "nothing-back": "came back empty",
};

/**
 * The user's reason for a refused regenerate, true of what came back: a
 * problem every version shares is said of every version; otherwise each
 * version's first problem is said of that one. Null when there is none.
 */
export function replanReason(
  versions: readonly (readonly RegenerateProblem[])[],
): string | null {
  const refused = versions.filter((v) => v.length > 0);
  if (refused.length === 0) return null;
  if (refused.length === 1 && versions.length <= 1) {
    const only = refused[0][0];
    return only.kind === "nothing-back"
      ? "No new version came back."
      : `The new version ${USER_REASON[only.kind]}.`;
  }
  const shared = refused[0].find((p) =>
    refused.every((v) => v.some((q) => q.kind === p.kind)),
  );
  if (shared && refused.length === versions.length) {
    return `Every new version ${USER_REASON[shared.kind]}.`;
  }
  const said = [...new Set(refused.map((v) => USER_REASON[v[0].kind]))];
  return said.length === 1
    ? `${refused.length === 1 ? "One" : "Each"} new version ${said[0]}.`
    : `One new version ${said[0]}; another ${said.slice(1).join("; another ")}.`;
}

/** A model rewrite none of whose versions could stand beside its set.
 *  The frame on show is kept. `problems` are the model-facing details,
 *  for the logs; the message is the user's. */
export class FrameReplanError extends Error {
  readonly problems: string[];
  readonly reasons: RegenerateProblemKind[];
  constructor(versions: readonly (readonly RegenerateProblem[])[]) {
    const reason = replanReason(versions);
    super(
      `KO couldn't rewrite this frame to fit the set.${reason ? ` ${reason}` : ""} The frame is unchanged. Try again, or edit its words.`,
    );
    this.name = "FrameReplanError";
    const found = versions.flat();
    this.problems = found.map((p) => p.detail);
    this.reasons = [...new Set(found.map((p) => p.kind))];
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

export interface FrameEditResult {
  beat: FrameBeat;
  /** Brief facts the set stated before the edit and no frame states now.
   *  The user's words still stand (H9); the job hands these on so the
   *  user is told what the set stopped saying: clearing a subheadline can
   *  drop the set's only price. */
  uncovered: BriefFact[];
}

/** Whether two headlines are the same words to a reader: case, spacing
 *  and punctuation aside ("Killed your last plant?!" is "Killed your last
 *  plant?"). */
export function sameWords(a: string, b: string): boolean {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^\p{L}\p{N}₦$£€%]+/gu, " ")
      .trim();
  return norm(a) === norm(b);
}

/**
 * The frame with the user's words as typed: no model call and no rewrite
 * (H9). Role, image and footer stay; the layout changes only when a
 * stat-highlight is left with no figure to set large (withFigureLayout).
 * Refused, with a reason the user can act on, only when the words cannot
 * be drawn: past a limit, an empty headline, a headline another frame
 * already has word for word (H4), a button on a frame that is not the
 * last, or the last frame left without one.
 */
export function applyFrameEdits(
  plan: PlannedSequence,
  index: number,
  edits: FrameEdits,
  facts: readonly BriefFact[] = [],
): FrameEditResult {
  const beat = plan.frames[index];
  if (!beat) {
    throw new RangeError(
      `applyFrameEdits: frame ${index} is outside a ${plan.frames.length}-frame set`,
    );
  }
  const headline = edited("headline", edits.headline, beat.headline);
  if (!headline) {
    throw new FrameEditError("Every frame needs a headline.", "headline");
  }
  const twin = plan.frames.findIndex(
    (other, i) => i !== index && sameWords(other.headline, headline),
  );
  if (edits.headline !== undefined && twin >= 0) {
    throw new FrameEditError(
      `Frame ${twin + 1} already has this headline. Give this frame its own.`,
      "headline",
    );
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
  const next = withFigureLayout({
    ...beat,
    title: settledTitle(beat.title, beat.title),
    headline,
    subheadline,
    cta,
  });
  const frames = plan.frames.map((b, i) => (i === index ? next : b));
  const before = new Set(factsUncovered(plan.frames, facts));
  return {
    beat: next,
    uncovered: factsUncovered(frames, facts).filter((f) => !before.has(f)),
  };
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
): RegenerateProblem[] {
  const before = plan.frames[index];
  const frames = plan.frames.map((beat, i) => (i === index ? next : beat));
  const roleBefore = new Set(roleProblems(plan.frames).map((p) => p.detail));
  const ignore = contentStems(brandName);
  /* Hard limits only: a headline a word over the format's budget is still
     drawn, and failing a paid regenerate over it would cost the user more
     than the word does. */
  const problems: RegenerateProblem[] = copyLimitProblems(
    next,
    index,
    plan.kind,
    { budget: false },
  ).map((p) => ({ kind: "too-long", detail: p.detail }));
  const add = (kind: RegenerateProblemKind, detail: string) =>
    problems.push({ kind, detail });
  if (isNearDuplicateHeadline(before.headline, next.headline, ignore)) {
    add(
      "same-as-before",
      `the headline "${next.headline}" says what it said before`,
    );
  }
  plan.frames.forEach((beat, i) => {
    if (
      i !== index &&
      isNearDuplicateHeadline(beat.headline, next.headline, ignore)
    ) {
      add(
        "repeats-frame",
        `the headline "${next.headline}" says what frame ${i + 1}'s "${beat.headline}" says`,
      );
    }
  });
  const wasUncovered = new Set(factsUncovered(plan.frames, facts));
  for (const fact of factsUncovered(frames, facts)) {
    if (!wasUncovered.has(fact)) {
      add("drops-fact", `it no longer states "${fact.text}"`);
    }
  }
  if (
    index === 0 &&
    offering &&
    !copyNamesOffering(next, offering) &&
    copyNamesOffering(before, offering)
  ) {
    add("drops-offering", `the hook no longer names "${offering}"`);
  }
  for (const made of invented) {
    add("invented", `it states "${made}", which the brief does not give`);
  }
  for (const role of roleProblems(frames)) {
    if (!roleBefore.has(role.detail)) add("role", role.detail);
  }
  const priced = new Set(
    misplacedPrices(plan.frames, facts, plan.kind)
      .filter((f) => f.frame === index)
      .map((f) => f.detail),
  );
  for (const fault of misplacedPrices(frames, facts, plan.kind)) {
    if (fault.frame === index && !priced.has(fault.detail)) {
      add("price-placement", fault.detail);
    }
  }
  for (const fact of factsTwiceInFrame(next, facts)) {
    add("fact-twice", `it gives "${fact.text}" twice on one frame`);
  }
  if (index === 0) {
    for (const fault of hookFaults(next, offering, names, brandName, facts)) {
      add("flat-hook", fault);
    }
    const previewed = new Set(hookPreviews(plan.frames, offering, brandName));
    for (const preview of hookPreviews(frames, offering, brandName)) {
      if (!previewed.has(preview)) add("hook-preview", preview);
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
    facts: sequenceFacts(
      read,
      context.brandSummary.name,
      context.briefText ?? "",
    ),
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
): Promise<{ beat: FrameBeat; modelCalls: number; uncovered: BriefFact[] }> {
  const beat = plan.frames[index];
  if (!beat) {
    throw new RangeError(
      `replanFrame: frame ${index} is outside a ${plan.frames.length}-frame set`,
    );
  }
  if (edits) {
    return {
      ...applyFrameEdits(plan, index, edits, deps.facts ?? []),
      modelCalls: 0,
    };
  }

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
    /* A footer line that repeats the copy above is dropped, as a planned
       set's is (withoutRepeats); code drops, it never writes. */
    const [next] = withoutRepeats(
      [
        withFigureLayout({
          ...withRewrite(beat, rewrite),
          title: settledTitle(beat.title, beat.title),
        }),
      ],
      facts,
      offering,
    );
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
  if (usable) return { beat: usable.next, modelCalls, uncovered: [] };
  throw new FrameReplanError(
    versions.length > 0
      ? versions.map((v) => v.problems)
      : [[{ kind: "nothing-back", detail: "no frame came back" }]],
  );
}
