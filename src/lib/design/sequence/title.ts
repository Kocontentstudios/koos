import { COPY_TARGETS } from "@/lib/jobs/directions/schema";
import {
  contentStems,
  isNearDuplicateHeadline,
} from "@/lib/jobs/directions/text-overlap";
import { upperFirst } from "./casing";
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
  /* "We work through", "Grids across": a preposition still waiting for
     what it governs. */
  "through",
  "across",
  "into",
  "onto",
  "within",
  "without",
  "between",
  "among",
  "toward",
  "towards",
  "via",
  "per",
  "than",
  "about",
  "is",
  "are",
  "who",
  "that",
  "which",
  "whose",
  "where",
  "every",
  "each",
  /* Verbs that need what follows them: "Every rider deserves" from
     "Every rider deserves to stay rolling". */
  "deserve",
  "deserves",
  "need",
  "needs",
  "want",
  "wants",
  "get",
  "gets",
  "help",
  "helps",
  "let",
  "lets",
  "make",
  "makes",
  "keep",
  "keeps",
  "bring",
  "brings",
  "give",
  "gives",
  "take",
  "takes",
]);
/* Labels the planner fills a slot with when it has no name: a card that
   says "How to act" names the planner's step, not the frame. */
const SCAFFOLD =
  /^(?:how to act|the action|call to action|cta|hook|body|point|frame|slide|untitled|title)(?:\s+\d+)?$/i;
/* The planner's names for a frame's job, anywhere in a title: "Family
   plan hook", "Hook: Our head chef", "CTA slide", "The hook". A card shows the
   client what the frame says, never which slot it fills. */
const ROLE_WORDS =
  /\b(?:hooks?|ctas?|call[\s-]to[\s-]action|closer|opener)\b|\b(?:slide|frame)(?:\s+\d+)?\s*$|^(?:slide|frame)\s+\d+\b/i;
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
  if (!/\p{L}{2,}/u.test(trimmed)) return "it is a bare figure, not a name";
  if (titleLeaks(trimmed).length > 0) return "it carries a planner label";
  if (
    trimmed.length > COPY_TARGETS.title.chars ||
    wordCount(trimmed) > COPY_TARGETS.title.words + 2
  ) {
    return "it is longer than a card shows";
  }
  if (SCAFFOLD.test(trimmed)) return "it is a placeholder, not a name";
  if (ROLE_WORDS.test(trimmed))
    return "it names the frame's job, not its point";
  if (wordCount(trimmed) < 2) return "it is one word, not a name";
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
      /* "Coworking space in Independence" from "Independence Layout": a
         name the title ends inside is cut, though a name after a whole
         phrase opens a new one, and an area's code ("Ikeja GRA") only
         qualifies the name before it. */
      const endsOnName = /^\p{Lu}/u.test(cased[i + mine.length - 1] ?? "");
      const nextCode = /^\p{Lu}{2,}$/u.test(cased[i + mine.length] ?? "");
      if (nextName && !nextCode && endsOnName && i + mine.length - 1 > 0) {
        return true;
      }
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

/** Whether a title shares no word with its own frame's headline,
 *  subheadline and button: a title must describe its own frame's final
 *  copy, so one left from before an edit, or one naming the frame's job
 *  ("The price"), is not a name for it. */
export function titleOffCopy(
  beat: Pick<FrameBeat, "title" | "headline" | "subheadline" | "cta">,
): boolean {
  const named = contentStems(beat.title);
  if (named.size === 0) return true;
  const mine = contentStems(copyOf(beat));
  return ![...named].some((s) => mine.has(s));
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
          : titleOffCopy(beat)
            ? `its title "${beat.title}" shares no word with its own frame's copy`
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

const capitalised = upperFirst;

/** The opening words of a headline that fit on a card and end on a word
 *  a phrase can end on, longest first: "Taught by teachers" and "Taught
 *  by" dropped, of "Taught by teachers who mark the exam". Two words at
 *  least; a two-word name is never read as cut (isCutTitle). */
export function headPhrases(headline: string): string[] {
  const words = headline
    .trim()
    .replace(/[.!?…]+$/u, "")
    .split(/\s+/)
    .filter(Boolean);
  const phrases: string[] = [];
  for (
    let n = Math.min(words.length, COPY_TARGETS.title.words);
    n >= 2;
    n -= 1
  ) {
    const kept = words.slice(0, n);
    const last = (kept.at(-1) ?? "").toLowerCase().replace(/[^\p{L}'-]/gu, "");
    if (OPEN_ENDS.has(last)) continue;
    if (kept.slice(0, -1).some((w) => /[,;:]$/.test(w))) continue;
    const phrase = kept.join(" ").replace(/[,;:]+$/u, "");
    if (phrase.length <= COPY_TARGETS.title.chars) phrases.push(phrase);
  }
  return phrases;
}

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
      ...headPhrases(beat.headline),
      ...headPhrases(beat.subheadline),
    ]
      .map((t) => capitalised(cleanTitle(t)))
      .filter(Boolean);
    const fits = (title: string) => {
      const trial = [...settled, { ...beat, title }, ...frames.slice(i + 1)];
      return !titleProblems(trial, rules).some((p) => p.frame === i);
    };
    const distinctClean = (t: string) =>
      isCleanTitle(t) && !settled.some((e) => sameTitle(e.title, t));
    const onCopy = (t: string) => !titleOffCopy({ ...beat, title: t });
    const title =
      candidates.find(fits) ??
      candidates.find(
        (t) => distinctClean(t) && onCopy(t) && !isCutTitle(t, rules.sources),
      ) ??
      candidates.find((t) => distinctClean(t) && onCopy(t)) ??
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
