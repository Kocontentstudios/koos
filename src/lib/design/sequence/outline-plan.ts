import { generateObject } from "ai";
import {
  buildArcPrompt,
  buildSequenceSystemPrompt,
} from "@/lib/ai/prompts/design-sequence";
import { getModel } from "@/lib/ai/provider";
import { brandFacts } from "@/lib/jobs/directions/brief";
import { factStated } from "@/lib/jobs/directions/brief-facts";
import type { BriefReader } from "@/lib/jobs/directions/brief-read";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import { type ArcFrame, type ArcPoint, pointPool, settleArc } from "./arc";
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
import { flagOutline, genericProfile } from "./outline-flags";
import { signPoint } from "./outline-sign";
import {
  failure,
  frameCountError,
  readSequenceBrief,
  type SequenceBrief,
} from "./read";
import { repairSequenceFor } from "./repair";
import { type ArcAnswer, arcResponseSchema } from "./schema";
import { cleanTitle } from "./title";

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

/* Words beyond its fact a sentence may hold to stand in for that fact on
   the action ("We are raising $750,000" holds one). */
const ACTION_SENTENCE_EXTRA = 2;

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
  /* "Contact founders@farmlink.ng. $750,000." glues a bare figure on; the
     brief's own sentence for it ("We are raising $750,000.") reads as one
     point. */
  const said = new Set(acting ? [acting] : []);
  const restSentences = rest.map((text) => {
    const factWords = contentStems(text, brief.free);
    /* Only a sentence that is little more than the fact: one that also
       says what the offer is would recap the hook on the action. */
    const holding = sentences.find(
      (s) =>
        !said.has(s) &&
        s.toLowerCase().includes(text.toLowerCase()) &&
        [...contentStems(s, brief.free)].filter((w) => !factWords.has(w))
          .length <= ACTION_SENTENCE_EXTRA,
    );
    if (!holding) return asSentence(text);
    said.add(holding);
    return asSentence(holding);
  });
  if (acting) {
    const point = [asSentence(acting), ...new Set(restSentences)].join(" ");
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

/* Words a title may end on only when more follows. */
const TRAILING =
  /\s+(?:a|an|the|and|or|of|to|in|on|for|with|by|at|is|are|we|our|your|it|from|against)$/i;
const TITLE_WORDS = 5;

/** A title made of a point's own opening words, cut at its first clause:
 *  "Customers pay ₦150 per kWh against…" is "Customers pay ₦150 per kWh". */
export function pointTitle(point: string): string {
  let title = point
    .replace(/[.;:,(—–].*$/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, TITLE_WORDS)
    .join(" ");
  while (TRAILING.test(title)) title = title.replace(TRAILING, "");
  return title || point.split(/\s+/).slice(0, TITLE_WORDS).join(" ");
}

/* Share of a title's own words its point must hold: "14 grids by 2027"
   over "Benue market towns, by end of 2027" shares only the year. */
const TITLE_SHARE = 0.5;

/** Whether a title is about its point: at least half its words and
 *  figures, beyond the names every point may carry, are the point's. */
export function titleFits(
  title: string,
  point: string,
  free: ReadonlySet<string> = new Set(),
): boolean {
  const mine = contentStems(point, free);
  const own = [...contentStems(title, free)];
  if (own.length === 0) return false;
  return own.filter((s) => mine.has(s)).length / own.length >= TITLE_SHARE;
}

/**
 * Each outline point's title. The arc titles each frame for the point it
 * assigned; settleArc may then move a point to another frame, so a title
 * follows its point, and a title that still shares nothing with its point
 * is made from the point's own words. A user editing an outline whose
 * titles belong to other points edits nonsense (O1 round-1 critic, HIGH 4).
 */
export function outlineTitles(
  answered: readonly Pick<ArcAnswer["frames"][number], "point" | "title">[],
  settled: readonly Pick<ArcFrame, "point" | "role">[],
  texts: readonly string[],
  free: ReadonlySet<string> = new Set(),
): string[] {
  const poolIndex = (n: number | undefined) =>
    Number.isInteger(n) && (n ?? 0) > 0 ? (n ?? 0) - 1 : null;
  const titleOf = new Map<number, string>();
  answered.forEach((frame) => {
    const at = poolIndex(frame.point);
    if (at !== null && !titleOf.has(at)) titleOf.set(at, frame.title);
  });
  return settled.map((frame, i) => {
    const asked = answered[i]?.title ?? "";
    const moved =
      frame.role === "body" &&
      frame.point !== null &&
      poolIndex(answered[i]?.point) !== frame.point;
    const candidate = moved ? (titleOf.get(frame.point ?? -1) ?? "") : asked;
    const title = cleanTitle(candidate);
    return title && titleFits(title, texts[i], free)
      ? title
      : pointTitle(texts[i]);
  });
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
  const texts = arc.frames.map((frame, i) => {
    const fromPool = frame.point === null ? null : pool[frame.point];
    const text =
      i === last
        ? action.point
        : frame.claim.trim() || fromPool?.text || EMPTY_POINT;
    return clipped(text, OUTLINE_LIMITS.pointChars);
  });
  const titles = outlineTitles(answer.frames, arc.frames, texts, free);
  const points: Omit<OutlinePoint, "weak">[] = arc.frames.map((frame, i) => {
    const fromPool = frame.point === null ? null : pool[frame.point];
    const point = texts[i];
    const source: OutlineSource =
      i === last
        ? action.source
        : fromPool
          ? SOURCE_OF[fromPool.source]
          : "brief";
    return {
      id: `p${i + 1}`,
      role: frame.role,
      title: clipped(
        sentenceCased(titles[i], names),
        OUTLINE_LIMITS.titleChars,
      ),
      point,
      source,
      facts: facts.filter((f) => factStated(f, point)).map((f) => f.text),
      sig: signPoint({ kind, briefText: brief.briefText, source, point }),
    };
  });
  const flagged = flagOutline(points, {
    kind,
    facts,
    free,
    audience: context.brandSummary.targetAudience,
    genericProfile: genericProfile(context.brandSummary),
  });
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
