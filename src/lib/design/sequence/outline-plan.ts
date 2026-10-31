import { generateObject } from "ai";
import {
  buildArcPrompt,
  buildSequenceSystemPrompt,
} from "@/lib/ai/prompts/design-sequence";
import { getModel } from "@/lib/ai/provider";
import { brandFacts } from "@/lib/jobs/directions/brief";
import { factStated } from "@/lib/jobs/directions/brief-facts";
import type { BriefReader } from "@/lib/jobs/directions/brief-read";
import { type ArcPoint, pointPool, settleArc } from "./arc";
import { sentenceCased } from "./casing";
import {
  FRAME_BOUNDS,
  OUTLINE_LIMITS,
  type OutlinePoint,
  type OutlineSource,
  type PlannedOutline,
  type PlanSequenceInput,
  PRESENTATION_ASPECT,
} from "./contract";
import { EMPTY_POINT } from "./outline-arc";
import { flagOutline } from "./outline-flags";
import {
  failure,
  frameCountError,
  readSequenceBrief,
  type SequenceBrief,
} from "./read";
import { repairSequenceFor } from "./repair";
import { type ArcAnswer, arcResponseSchema } from "./schema";

export type PlanOutlineInput = Pick<
  PlanSequenceInput,
  "context" | "kind" | "frameCount" | "memorySummary"
>;

export interface PlanOutlineDeps {
  briefReader?: BriefReader;
}

export interface PlanOutlineResult {
  /** Flagged (flagOutline) before it is returned. */
  outline: PlannedOutline;
  modelCalls: number;
  ms: number;
}

const ARC_MAX_OUTPUT_TOKENS = 3000;

const SOURCE_OF: Record<ArcPoint["source"], OutlineSource> = {
  brief: "brief",
  fact: "brief",
  profile: "profile",
  value: "profile",
  user: "user",
};

/** `text` cut at a word to fit `max` characters. */
export function clipped(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > max / 2 ? cut.slice(0, atWord) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

/* What a brief says the reader does to act: a sentence holding its
   contact, else one asking for the action. */
const ACTING =
  /\b(?:book|order|reserve|call|whatsapp|dm|message|email|contact|sign\s+up|register|visit|buy|shop|apply|join|rsvp|enrol|enroll|text|download|subscribe|partner|invest|get\s+in\s+touch)\b/i;

const asSentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

/**
 * The action's point in plain words: the brief's sentence that says how
 * to act, with the facts the action frame carries that it leaves out (a
 * carousel's price, a contact), else those facts alone. Never invented:
 * with nothing to act on in the brief, it asks the owner for one.
 */
export function actionPoint(brief: SequenceBrief): {
  point: string;
  source: OutlineSource;
} {
  const { facts, atAction, briefText } = brief;
  const carried = facts.filter(
    (f, n) => f.kind === "contact" || atAction.has(n),
  );
  const sentences = sentencesOf(briefText);
  const acting =
    sentences.find((s) =>
      carried.some((f) => f.kind === "contact" && factStated(f, s)),
    ) ?? sentences.find((s) => ACTING.test(s));
  const rest = carried
    .filter((f) => !acting || !factStated(f, acting))
    .map((f) => f.text);
  if (acting) {
    const point = [asSentence(acting), ...rest.map(asSentence)].join(" ");
    return {
      point: clipped(point, OUTLINE_LIMITS.pointChars),
      source: "brief",
    };
  }
  if (rest.length > 0) {
    return {
      point: clipped(
        `How to act: ${rest.join(", ")}.`,
        OUTLINE_LIMITS.pointChars,
      ),
      source: "brief",
    };
  }
  return {
    point: "How should readers act? Add your contact, link or place.",
    source: "brief",
  };
}

/**
 * The outline of a set: exactly frameCount points, hook first and action
 * last, each one claim in plain words with its source. Reads the brief
 * and builds the pool the way planSequence does (pointPool, settleArc), so
 * the outline and the planner agree on what a point is. No copy, no
 * render, no quota.
 */
export async function planOutline(
  input: PlanOutlineInput,
  { briefReader }: PlanOutlineDeps = {},
): Promise<PlanOutlineResult> {
  const { context, kind, frameCount } = input;
  const bounds = FRAME_BOUNDS[kind];
  if (
    !Number.isInteger(frameCount) ||
    frameCount < bounds.min ||
    frameCount > bounds.max
  ) {
    throw new RangeError(frameCountError("planOutline", kind, frameCount));
  }
  const started = Date.now();
  const brief = await readSequenceBrief(context, kind, briefReader);
  let modelCalls = 1;
  const { facts, free, atAction, offering, offeringIndex } = brief;
  const pool = pointPool({
    facts,
    briefText: brief.briefText,
    brand: context.brandSummary,
    kind,
    free,
    slots: frameCount - 1,
    atAction,
  });
  const aspectRatio =
    kind === "presentation" ? PRESENTATION_ASPECT : context.aspectRatio;
  const system = buildSequenceSystemPrompt(
    context.brandSummary,
    Boolean(context.brand?.logoUrl),
    { memorySummary: input.memorySummary ?? "", recentLayouts: [] },
  );
  const prompt = buildArcPrompt(context, {
    kind,
    frameCount,
    aspectRatio,
    pool,
    actionFacts: facts
      .filter((f, n) => f.kind === "contact" || atAction.has(n))
      .map((f) => f.text),
    offering,
    imageSource: "none",
    imageAttached: false,
  });
  const ask = async (): Promise<ArcAnswer> => {
    modelCalls += 1;
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema: arcResponseSchema(frameCount),
      system,
      maxOutputTokens: ARC_MAX_OUTPUT_TOKENS,
      experimental_repairText: repairSequenceFor(frameCount),
      prompt,
    });
    return object as ArcAnswer;
  };
  /* An answer off the schema is asked for once more, as the planner's
     calls are. */
  const answer = await ask().catch((err) => {
    if ((err as Error)?.name !== "AI_NoObjectGeneratedError") throw err;
    console.error(
      "outline arc did not match the schema; asking again",
      failure(err),
    );
    return ask();
  });
  const arc = settleArc(answer, {
    pool,
    facts,
    kind,
    offeringFact: offeringIndex >= 0 ? offeringIndex : null,
    hasImage: true,
    free,
    atAction,
  });
  const last = frameCount - 1;
  const action = actionPoint(brief);
  const names = [
    brief.briefText,
    context.title,
    brief.brandName,
    offering,
    ...brandFacts(context.brandSummary),
  ];
  const points: Omit<OutlinePoint, "weak">[] = arc.frames.map((frame, i) => {
    const fromPool = frame.point === null ? null : pool[frame.point];
    const text =
      i === last
        ? action.point
        : frame.claim.trim() || fromPool?.text || EMPTY_POINT;
    const point = clipped(text, OUTLINE_LIMITS.pointChars);
    return {
      id: `p${i + 1}`,
      role: frame.role,
      title: clipped(
        sentenceCased(frame.title, names),
        OUTLINE_LIMITS.titleChars,
      ),
      point,
      source:
        i === last
          ? action.source
          : fromPool
            ? SOURCE_OF[fromPool.source]
            : "brief",
      facts: facts.filter((f) => factStated(f, point)).map((f) => f.text),
    };
  });
  const flagged = flagOutline(points, {
    kind,
    facts,
    free,
    audience: context.brandSummary.targetAudience,
  }).map((p) =>
    p.point === EMPTY_POINT
      ? {
          ...p,
          weak: {
            kind: "filler" as const,
            reason:
              "Nothing in the brief or profile was left for this slide. Write its point, or delete it.",
          },
        }
      : p,
  );
  const outline: PlannedOutline = {
    kind,
    frameCount,
    points: flagged,
    offering,
    facts: facts.map((f) => f.text),
  };
  const ms = Date.now() - started;
  const count = (k: string) => flagged.filter((p) => p.weak?.kind === k).length;
  console.info("design.outline.planned", {
    kind,
    frames: frameCount,
    weak: {
      overlap: count("overlap"),
      filler: count("filler"),
      profileFill: count("profile-fill"),
    },
    modelCalls,
    ms,
  });
  return { outline, modelCalls, ms };
}
