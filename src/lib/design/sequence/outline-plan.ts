import { generateObject } from "ai";
import {
  buildArcPrompt,
  buildSequenceSystemPrompt,
} from "@/lib/ai/prompts/design-sequence";
import { getModel } from "@/lib/ai/provider";
import { brandFacts } from "@/lib/jobs/directions/brief";
import { type BriefFact, factStated } from "@/lib/jobs/directions/brief-facts";
import type { BriefReader } from "@/lib/jobs/directions/brief-read";
import { COPY_TARGETS } from "@/lib/jobs/directions/schema";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import {
  type ArcFrame,
  type ArcPoint,
  pointPool,
  settleArc,
  sparePoints,
} from "./arc";
import { sentenceCased, upperFirst } from "./casing";
import {
  OUTLINE_LIMITS,
  type OutlinePoint,
  type OutlineSource,
  type PlannedOutline,
  type PlanSequenceInput,
  PRESENTATION_ASPECT,
} from "./contract";
import { EMPTY_POINT } from "./outline-arc";
import {
  flagOutline,
  genericProfile,
  type OutlineFlagContext,
} from "./outline-flags";
import { signPoint } from "./outline-sign";
import { profileStatements } from "./points";
import {
  failure,
  frameCountError,
  readSequenceBrief,
  type SequenceBrief,
} from "./read";
import { repairSequenceFor } from "./repair";
import { type ArcAnswer, arcResponseSchema } from "./schema";
import { cleanTitle, isCleanTitle } from "./title";

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

/* Words a lead may hold before its fact: "We are raising $1.2 million"
   of "We are raising $1.2 million to build 20 more grids". */
const LEAD_EXTRA = 3;

/** The brief's own words up to and through `fact`, when they are little
 *  more than the fact: a figure glued on bare ("Contact Ibrahim Musa.
 *  $1.2 million.") tells the owner nothing they can edit. */
export function leadUpTo(
  fact: string,
  sentences: readonly string[],
  free: ReadonlySet<string> = new Set(),
): string | null {
  const factWords = contentStems(fact, free);
  for (const sentence of sentences) {
    const at = sentence.toLowerCase().indexOf(fact.toLowerCase());
    if (at < 0) continue;
    const lead = sentence.slice(0, at + fact.length).trim();
    const extra = [...contentStems(lead, free)].filter(
      (w) => !factWords.has(w),
    );
    if (extra.length <= LEAD_EXTRA && lead.length > fact.length) return lead;
  }
  return null;
}

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
    if (holding) {
      said.add(holding);
      return asSentence(holding);
    }
    return asSentence(leadUpTo(text, sentences, brief.free) ?? text);
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

/* Words a title never starts or ends on: a phrase cut before or after
   one of these is whole ("Coach on the floor"), one ending on it is not
   ("A coach is on the"). */
const JOINING = new Set(
  "a an the and or of to in on for with by at from against into over under per than so but as if when while who which that this these those our your their its my his her we you they it is are was were be been".split(
    " ",
  ),
);
/* Dropped from a title as a card label drops them: "Tariffs are 40%
   below diesel" titles as "Tariffs 40% below diesel". */
const COPULA = new Set(["is", "are", "was", "were"]);
const TITLE_WORDS = 4;
const TITLE_MIN_WORDS = 2;
const WHOLE_CLAUSE_WORDS = 5;
const EMPTY_TITLE = "Add a point";
const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** `title` within `max` characters, cut at a whole word and never given
 *  an ellipsis: a card title reads as a name, not as cut-off copy. */
export function titleWithin(title: string, max: number): string {
  const words = title.replace(/\s+/g, " ").trim().split(" ");
  while (words.length > 1 && words.join(" ").length > max) words.pop();
  while (words.length > 1 && JOINING.has(keyOf(words.at(-1) ?? ""))) {
    words.pop();
  }
  return words.join(" ").slice(0, max);
}

/* A clause ends at a sentence mark, a dash or a comma that is not inside
   a number ("1,200" stays whole). */
const firstClause = (point: string) =>
  point.split(/[.;:(—–!?]|,(?!\d)/)[0] ?? point;

const keyOf = (word: string) =>
  word.toLowerCase().replace(/[^\p{L}\p{N}'’-]/gu, "");

/**
 * A title of 2 to 4 of a point's own words that is a whole phrase: a run
 * in its first clause that starts and ends on a word of its own, with a
 * joining word or the clause's edge on either side; the one opening on
 * the clause's subject first, else the longest, the earliest on a tie. The brand's own names opening the point are left
 * out ("Fixit Hub replaces your cracked iPhone screen the same day" is
 * "Cracked iPhone screen"), and so are "is" and "are". A point with no such
 * run takes its opening words up to the last word of its own.
 */
export function pointTitle(
  point: string,
  free: ReadonlySet<string> = new Set(),
): string {
  let words = firstClause(point)
    .split(/\s+/)
    .filter((w) => w && !COPULA.has(keyOf(w)));
  const names = words.findIndex((w) => !free.has(keyOf(w)));
  if (names > 0 && words.length - names >= TITLE_MIN_WORDS) {
    words = words.slice(names);
  }
  const joining = (i: number) => JOINING.has(keyOf(words[i] ?? ""));
  const subject = words.findIndex((_, i) => !joining(i));
  /* The clause's own subject first: "Revenue grew 3x", never "2025 to
     ₦210 million" from later in the same clause. */
  const rank = ([start, end]: [number, number]) =>
    (start === subject ? 10 : 0) + (end - start);
  let best: [number, number] | null = null;
  for (let start = 0; start < words.length; start += 1) {
    if (joining(start) || (start > 0 && !joining(start - 1))) continue;
    for (let end = start + TITLE_MIN_WORDS; end <= words.length; end += 1) {
      if (end - start > TITLE_WORDS) break;
      if (joining(end - 1)) continue;
      if (end < words.length && !joining(end)) continue;
      /* A run ending on a verb that wants its object ("Full tune-up
         keeps") is a phrase cut, not a name. */
      if (!isCleanTitle(words.slice(start, end).join(" "))) continue;
      if (!best || rank([start, end]) > rank(best)) best = [start, end];
    }
  }
  /* Two words before a joining word leave a short clause cut ("Keep
     riders" of "Keep riders on the road"): the whole clause names it
     when a card can show it. */
  const clause = words.join(" ");
  if (
    best &&
    best[1] - best[0] === TITLE_MIN_WORDS &&
    words.length <= WHOLE_CLAUSE_WORDS &&
    clause.length <= COPY_TARGETS.title.chars &&
    isCleanTitle(clause)
  ) {
    return upperFirst(clause);
  }
  if (best) return upperFirst(words.slice(best[0], best[1]).join(" "));
  const opening = words.slice(0, TITLE_WORDS);
  while (opening.length > 1 && joining(opening.length - 1)) opening.pop();
  return upperFirst(opening.join(" ") || point.trim());
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
 * titles belong to other points edits nonsense.
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
    if (texts[i] === EMPTY_POINT) return EMPTY_TITLE;
    const title = cleanTitle(candidate);
    return title &&
      wordCount(title) <= TITLE_WORDS &&
      titleFits(title, texts[i], free)
      ? title
      : pointTitle(texts[i], free);
  });
}

/** Where the hook's angle comes from. The model writes it in its own
 *  words from the whole brief, so the pool point it was assigned says
 *  little: it is the brief's when it shares at least as many of its words
 *  with the brief as with the profile. */
export function hookSource(
  point: string,
  briefText: string,
  profile: readonly string[],
): Exclude<OutlineSource, "user"> {
  const own = contentStems(point);
  const shared = (text: string) => {
    const theirs = contentStems(text);
    return [...own].filter((s) => theirs.has(s)).length;
  };
  return shared(briefText) >= shared(profile.join(" ")) ? "brief" : "profile";
}

export interface PlacedPoint {
  text: string;
  source: OutlineSource;
  role: OutlinePoint["role"];
}

/** Every brief sentence that states `fact`, in brief order. */
const sentencesStating = (fact: BriefFact, briefText: string) =>
  sentencesOf(briefText).filter((s) => factStated(fact, s));

/* Which body point gives way to a hard brief fact: one with nothing on
   it first, then one the profile filled. A brief point is never
   displaced: it already carries what the owner asked for. */
const GIVES_WAY: readonly OutlineSource[] = ["user", "profile"];

/* A when, where, price or contact belongs beside the action: on a slide of
   its own it is filler the owner is told to replace, and replacing it
   would take the fact off the set. */
const AT_ACTION = new Set<BriefFact["kind"]>([
  "date",
  "day",
  "time",
  "place",
  "contact",
  "price",
]);

/**
 * The outline's points with every hard brief fact on one of them (H5).
 * The arc may leave a fact on no point ("One 60-minute session", "3
 * March") while it fills a slide from the profile or leaves one empty;
 * the owner is then told the brief is used up when it is not, and once
 * they edit the outline nothing puts the fact back. So a claim fact (a
 * count, an offer, a condition) takes the emptiest body slot in the
 * brief's own sentence; a when, where or price, and a claim fact with no
 * slot left, joins the action's point.
 */
export function withEveryFactPlaced(
  points: readonly PlacedPoint[],
  facts: readonly BriefFact[],
  briefText: string,
): PlacedPoint[] {
  const next = points.map((p) => ({ ...p }));
  const states = (fact: BriefFact) =>
    next.some((p) => p.text !== EMPTY_POINT && factStated(fact, p.text));
  const slotFor = () => {
    for (const source of GIVES_WAY) {
      const at = next.findIndex(
        (p) =>
          p.role === "body" &&
          p.source === source &&
          !facts.some((f) => f.kind !== "product" && factStated(f, p.text)),
      );
      if (at >= 0) return at;
    }
    return -1;
  };
  const sentences = sentencesOf(briefText);
  for (const fact of facts) {
    if (fact.kind === "product" || states(fact)) continue;
    const sentence = sentencesStating(fact, briefText)[0];
    if (!sentence) continue;
    const at = AT_ACTION.has(fact.kind) ? -1 : slotFor();
    if (at >= 0) {
      next[at] = {
        ...next[at],
        text: clipped(asSentence(sentence), OUTLINE_LIMITS.pointChars),
        source: "brief",
      };
      continue;
    }
    const action = next.at(-1);
    if (!action) continue;
    const already = action.text.toLowerCase();
    const candidates = [
      sentence,
      leadUpTo(fact.text, sentences),
      fact.text,
    ].filter((t): t is string => Boolean(t));
    /* Two facts of one sentence ("Saturday 15 November, 8am to 2pm") are
       joined once; the reader would see the sentence twice. */
    if (
      candidates.some((t) =>
        already.includes(t.toLowerCase().replace(/[.!?]$/, "")),
      )
    ) {
      continue;
    }
    const said = candidates
      .map((t) => `${asSentence(action.text)} ${asSentence(t)}`)
      .find((joined) => joined.length <= OUTLINE_LIMITS.pointChars);
    if (said) next[next.length - 1] = { ...action, text: said };
  }
  return next;
}

/**
 * The outline of a set: exactly frameCount points, hook first and action
 * last, each one claim in plain words with its source. Reads the brief
 * and builds the pool the way planSequence does (pointPool, settleArc), so
 * the outline and the planner agree on what a point is. No copy, no
 * render, no quota.
 */
/**
 * The drafted points with every body point that makes another's point
 * (flagOutline "overlap") given a spare point from the pool in its place:
 * an outline that says one thing twice is the planner's fault, never the
 * owner's to find. A point is swapped only when the spare overlaps no
 * point, and only when nothing it alone states (a brief fact) would leave
 * the set. A point no spare can replace keeps its flag.
 */
export function withOverlapsSwapped(
  drafts: readonly PlacedPoint[],
  spares: readonly ArcPoint[],
  ctx: OutlineFlagContext,
): { points: PlacedPoint[]; swapped: number[] } {
  const points = [...drafts];
  const left = [...spares];
  const swapped: number[] = [];
  const flags = (list: readonly PlacedPoint[]) =>
    flagOutline(
      list.map((p, i) => ({
        id: `p${i + 1}`,
        role: p.role,
        title: "",
        point: p.text,
        source: p.source,
        facts: [],
      })),
      ctx,
    );
  const onlyHere = (i: number) =>
    ctx.facts.some(
      (f) =>
        factStated(f, points[i].text) &&
        !points.some((p, k) => k !== i && factStated(f, p.text)),
    );
  for (let i = 1; i < points.length - 1; i += 1) {
    if (flags(points)[i].weak?.kind !== "overlap" || onlyHere(i)) continue;
    const pick = left.findIndex((spare) => {
      const next = points.map((p, k) =>
        k === i
          ? { text: spare.text, source: SOURCE_OF[spare.source], role: p.role }
          : p,
      );
      return flags(next).every((f) => f.weak?.kind !== "overlap");
    });
    if (pick < 0) continue;
    const [spare] = left.splice(pick, 1);
    points[i] = {
      text: clipped(spare.text, OUTLINE_LIMITS.pointChars),
      source: SOURCE_OF[spare.source],
      role: points[i].role,
    };
    swapped.push(i);
  }
  return { points, swapped };
}

export async function planOutline(
  input: PlanOutlineInput,
  { briefReader }: PlanOutlineDeps = {},
): Promise<PlanOutlineResult> {
  const { context, kind, frameCount } = input;
  const countError = frameCountError("planOutline", kind, frameCount);
  if (countError) throw new RangeError(countError);
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
  const planned = arc.frames.map((frame, i) => {
    const fromPool = frame.point === null ? null : pool[frame.point];
    const text =
      i === last
        ? action.point
        : frame.claim.trim() || fromPool?.text || EMPTY_POINT;
    return clipped(text, OUTLINE_LIMITS.pointChars);
  });
  const profile = profileStatements(context.brandSummary);
  const plannedSources: OutlineSource[] = arc.frames.map((frame, i) => {
    const fromPool = frame.point === null ? null : pool[frame.point];
    if (i === last) return action.source;
    if (i === 0) return hookSource(planned[i], brief.briefText, profile);
    if (planned[i] === EMPTY_POINT) return "user";
    return fromPool ? SOURCE_OF[fromPool.source] : "brief";
  });
  const flagContext: OutlineFlagContext = {
    kind,
    facts,
    free,
    audience: context.brandSummary.targetAudience,
    genericProfile: genericProfile(context.brandSummary),
  };
  const unique = withOverlapsSwapped(
    withEveryFactPlaced(
      planned.map((text, i) => ({
        text,
        source: plannedSources[i],
        role: arc.frames[i].role,
      })),
      facts,
      brief.briefText,
    ),
    sparePoints(arc, pool, facts, free).map((i) => pool[i]),
    flagContext,
  );
  const placed = unique.points;
  const texts = placed.map((p) => p.text);
  const titles = outlineTitles(answer.frames, arc.frames, texts, free);
  const points: Omit<OutlinePoint, "weak">[] = arc.frames.map((frame, i) => {
    const point = texts[i];
    const source = placed[i].source;
    return {
      id: `p${i + 1}`,
      role: frame.role,
      title: titleWithin(
        sentenceCased(titles[i], names),
        OUTLINE_LIMITS.titleChars,
      ),
      point,
      source,
      facts: facts.filter((f) => factStated(f, point)).map((f) => f.text),
      sig: signPoint({
        kind,
        briefText: brief.briefText,
        role: frame.role,
        source,
        point,
      }),
    };
  });
  const flagged = flagOutline(points, flagContext);
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
    overlapsSwapped: unique.swapped.length,
    modelCalls,
    ms,
  });
  return { outline, modelCalls, ms };
}
