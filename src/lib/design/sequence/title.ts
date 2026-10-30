import { COPY_TARGETS } from "@/lib/jobs/directions/schema";
import {
  contentStems,
  isNearDuplicateHeadline,
} from "@/lib/jobs/directions/text-overlap";
import type { FrameBeat } from "./contract";

/**
 * A frame's title is shown to the user on its card and as the viewer's
 * heading (set-model.ts, set-viewer.tsx), so it must read as a name for the
 * frame, never as the planner's working notes. The fix call asks for
 * several versions per frame and the model labels them inside the title
 * ("Roasted in-house — version A", "Reserve yours — B", "Shirts and
 * repairs too (P1)").
 */

/* A version or draft label at the end, with whatever trails it, and the
   prompt's source ids (P1, B2). */
const VERSION_LABEL =
  /\s*[-–—:,([]*\s*(?:\b[Vv]ersion\s+(?:[A-Za-z]|\d+)|\b(?:[Dd]raft|[Oo]ption|[Vv]ariant|[Aa]lt(?:ernative)?)\s+(?:[A-Z]|\d+)|\b[Vv]\d+)\b.*$/;
const SOURCE_ID = /\s*[([]?\b[PB]\d{1,2}\b[)\]]?/g;
/* A version's letter after a dash or in brackets: "Reserve yours — A". */
const VERSION_LETTER = /\s+(?:[-–—:]\s*\(?|\()[A-Da-d1-4]\)?\s*$/;
const DANGLING = /[\s\-–—:,;([]+$/;

/** The words of a title that are the planner's, not the frame's. */
export function titleLeaks(title: string): string[] {
  const leaks: string[] = [];
  const version = VERSION_LABEL.exec(title) ?? VERSION_LETTER.exec(title);
  if (version) leaks.push(version[0].trim());
  for (const id of title.matchAll(SOURCE_ID)) leaks.push(id[0].trim());
  return leaks;
}

/** `title` without a version label or a source id. Empty when nothing of
 *  the frame's own name is left. */
export function cleanTitle(title: string): string {
  return title
    .replace(VERSION_LABEL, "")
    .replace(VERSION_LETTER, "")
    .replace(SOURCE_ID, "")
    .replace(DANGLING, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/* Words a name never ends on: "For women who" and "Beans from one" read as
   cut off mid-phrase. */
const OPEN_ENDS = new Set([
  "a",
  "an",
  "the",
  "our",
  "your",
  "their",
  "its",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "and",
  "or",
  "but",
  "by",
  "at",
  "from",
  "is",
  "are",
  "who",
  "that",
  "which",
  "whose",
  "where",
  "every",
  "each",
]);
/* Labels the planner fills a slot with when it has no name: a card that
   says "How to act" names the planner's step, not the frame. */
const SCAFFOLD =
  /^(?:how to act|the action|call to action|cta|hook|body|point|frame|slide|untitled|title)(?:\s+\d+)?$/i;
const SERIES =
  /\b(?:series|round|class|grade|plan|type|tier|phase|block)\s+\p{Lu}$/iu;
/* A figure whose separator was stripped: "$1 2m" for "$1.2m", "₦18 000"
   for "₦18,000". */
const STRIPPED_FIGURE = /\d\s\d/;

/** Why a title does not read as the frame's name, or null: a planner
 *  label, too long for a card, cut off, a scaffold label or a figure that
 *  lost its comma. */
export function titleFault(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return "it is empty";
  if (titleLeaks(trimmed).length > 0) return "it carries a planner label";
  if (
    trimmed.length > COPY_TARGETS.title.chars ||
    wordCount(trimmed) > COPY_TARGETS.title.words + 2
  ) {
    return "it is longer than a card shows";
  }
  if (SCAFFOLD.test(trimmed)) return "it is a placeholder, not a name";
  if (STRIPPED_FIGURE.test(trimmed)) return "a figure in it lost its comma";
  /* "Series A" names a round; "Services B" is a version's letter, and
     "a" at the end an article left hanging. */
  if (/\s\p{Lu}$/u.test(trimmed) && !SERIES.test(trimmed)) {
    return "it carries a planner label";
  }
  const last = (trimmed.split(/\s+/).pop() ?? "").replace(/[^\p{L}'-]/gu, "");
  if (!SERIES.test(trimmed) && OPEN_ENDS.has(last.toLowerCase())) {
    return "it stops mid-phrase";
  }
  if (/[,;:\-–—]$/.test(trimmed)) return "it stops mid-phrase";
  return null;
}

/** Whether a title reads as the frame's name (titleFault). */
export function isCleanTitle(title: string): boolean {
  return titleFault(title) === null;
}

/* A name of one or two words is often a phrase's head on its own
   ("Nothing artificial" of "Nothing artificial added"); past that, a
   source going on is a phrase cut short. */
const CUT_MIN_WORDS = 3;

/* Words and marks in reading order, a figure kept whole ("₦18,000" is one
   word), so a title is matched against a source token for token. */
const tokensOf = (text: string) =>
  [
    ...text
      .toLowerCase()
      .replace(/(\d)[,.](\d)/g, "$1$2")
      .matchAll(/[\p{L}\p{N}'’₦$£€%-]+|[^\s\p{L}\p{N}'’₦$£€%-]/gu),
  ].map((m) => m[0]);

const isWord = (token: string | undefined) =>
  token !== undefined && /[\p{L}\p{N}]/u.test(token);

/* Words that open a new phrase, so a source going on with one after the
   title's words has not been cut: "Free repotting for life" gives the
   whole name "Free repotting". */
const PHRASE_OPENERS = new Set([
  "a",
  "an",
  "the",
  "for",
  "with",
  "in",
  "on",
  "at",
  "from",
  "to",
  "and",
  "or",
  "but",
  "so",
  "by",
  "since",
  "until",
  "before",
  "after",
  "while",
  "because",
  "is",
  "are",
  "was",
  "were",
  "against",
  "per",
  "over",
  "under",
  "across",
  "through",
  "without",
  "within",
  "into",
  "than",
  "like",
  "about",
  "around",
  "who",
  "that",
  "which",
  "where",
  "when",
  "not",
  "belongs",
  "has",
  "have",
  "gets",
  "makes",
  "keeps",
  "stays",
  "means",
  "runs",
  "works",
  "comes",
]);

/**
 * Whether a title is the first words of a longer phrase in one of the
 * sources with the rest cut away: "Taught by volunteer" from "Taught by
 * volunteer engineers", "Solar kits for small" from "Solar kits for small
 * shops". A source that goes on past the title with a mark or a word that
 * opens a new phrase gave the title whole.
 */
export function isCutTitle(title: string, sources: readonly string[]): boolean {
  const mine = tokensOf(title.trim().replace(/[.!?…]+$/u, ""));
  if (mine.filter(isWord).length < CUT_MIN_WORDS) return false;
  return sources.some((source) => {
    const tokens = tokensOf(source);
    const cased = [
      ...source
        .replace(/(\d)[,.](\d)/g, "$1$2")
        .matchAll(/[\p{L}\p{N}'’₦$£€%-]+|[^\s\p{L}\p{N}'’₦$£€%-]/gu),
    ].map((m) => m[0]);
    for (let i = 0; i + mine.length < tokens.length; i += 1) {
      if (!mine.every((t, k) => tokens[i + k] === t)) continue;
      const next = tokens[i + mine.length];
      const nextName = /^\p{Lu}/u.test(cased[i + mine.length] ?? "");
      const nextFigure = /^\p{N}/u.test(next ?? "");
      if (
        isWord(next) &&
        !PHRASE_OPENERS.has(next) &&
        !nextName &&
        !nextFigure
      ) {
        return true;
      }
    }
    return false;
  });
}

/** Whether two card titles name one frame: the same words ignoring case,
 *  or near-duplicate wording. */
export function sameTitle(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a) === norm(b) || isNearDuplicateHeadline(a, b);
}

const copyOf = (beat: Pick<FrameBeat, "headline" | "subheadline" | "cta">) =>
  `${beat.headline} ${beat.subheadline} ${beat.cta}`;

/**
 * Whether a title names another frame rather than its own: it shares no
 * word with its own frame's copy and does share one with another's ("Ikoyi
 * roots" over a frame about the morning's baking, beside the frame about
 * the bakery in Ikoyi). A title sharing words with neither ("The price")
 * names the frame's job and stands. Every word counts, the brand's and the
 * offering's too, so the planner and the eval, which may read the
 * offering in different words, reach one answer.
 */
export function titleOffFrame(
  frames: readonly Pick<
    FrameBeat,
    "title" | "headline" | "subheadline" | "cta"
  >[],
  index: number,
): boolean {
  const own = frames[index];
  if (!own) return false;
  const named = contentStems(own.title);
  if (named.size === 0) return false;
  const mine = contentStems(copyOf(own));
  if ([...named].some((s) => mine.has(s))) return false;
  return frames.some((other, i) => {
    if (i === index) return false;
    const theirs = contentStems(copyOf(other));
    return [...named].some((s) => theirs.has(s));
  });
}

export interface TitleRules {
  /** Where a cut title would come from: the brief, the brand profile. */
  sources: readonly string[];
}

/** Each frame whose title is not a clean, whole, distinct name for its own
 *  copy, with why. The eval's titleClean gate and the planner's title
 *  faults read the same rule. */
export function titleProblems(
  frames: readonly Pick<
    FrameBeat,
    "title" | "headline" | "subheadline" | "cta"
  >[],
  { sources }: TitleRules,
): { frame: number; detail: string }[] {
  return frames.flatMap((beat, frame) => {
    const fault = titleFault(beat.title);
    const detail = fault
      ? `its title "${beat.title}" does not read as a name: ${fault}`
      : isCutTitle(beat.title, sources)
        ? `its title "${beat.title}" is a phrase cut off mid-way`
        : frames.some((e, k) => k < frame && sameTitle(e.title, beat.title))
          ? `its title "${beat.title}" is an earlier frame's title`
          : titleOffFrame(frames, frame)
            ? `its title "${beat.title}" names another frame's point, not this one's`
            : null;
    return detail ? [{ frame, detail }] : [];
  });
}

/* A headline's clauses, each a candidate name: "Free repotting, for life"
   offers "Free repotting, for life" and "Free repotting". */
function clausesOf(text: string): string[] {
  const whole = text.trim().replace(/[.!?…]+$/u, "");
  const parts = whole
    .split(/\s*(?:[,;:?!.]|\s[-–—]\s)\s*/u)
    .map((p) => p.trim())
    .filter(Boolean);
  return [whole, ...parts];
}

const capitalised = (text: string) =>
  text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;

/**
 * Every frame's title settled against its final copy, in order: the title
 * it has, the arc's, then the frame's own headline or one of its clauses,
 * and the last frame's button; the first that is a clean, whole name for
 * this frame (titleProblems) and no earlier frame's. A frame with none
 * keeps the cleanest it has.
 */
export function withSettledTitles<T extends FrameBeat>(
  frames: readonly T[],
  rules: TitleRules,
  proposals: readonly (readonly string[])[] = [],
): T[] {
  const settled: T[] = [];
  frames.forEach((beat, i) => {
    const candidates = [
      beat.title,
      ...(proposals[i] ?? []),
      ...clausesOf(beat.headline),
      ...(beat.role === "cta" ? clausesOf(beat.cta) : []),
      ...clausesOf(beat.subheadline),
    ]
      .map((t) => capitalised(cleanTitle(t)))
      .filter(Boolean);
    const fits = (title: string) => {
      const trial = [...settled, { ...beat, title }, ...frames.slice(i + 1)];
      return !titleProblems(trial, rules).some((p) => p.frame === i);
    };
    const distinctClean = (t: string) =>
      isCleanTitle(t) && !settled.some((e) => sameTitle(e.title, t));
    const title =
      candidates.find(fits) ??
      candidates.find(
        (t) => distinctClean(t) && !isCutTitle(t, rules.sources),
      ) ??
      candidates.find(distinctClean) ??
      beat.title;
    settled.push({ ...beat, title });
  });
  return settled;
}

/** The title a frame keeps: the proposed one cleaned, when it still reads
 *  as a name, else the one it had. */
export function settledTitle(proposed: string, current: string): string {
  const cleaned = cleanTitle(proposed);
  if (isCleanTitle(cleaned)) return cleaned;
  const kept = cleanTitle(current);
  return kept || cleaned || current.trim();
}
