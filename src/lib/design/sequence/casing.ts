import type { FrameBeat } from "./contract";

/**
 * One casing across a set's headlines. A set read in order with "Taught by
 * Teachers Who Mark WAEC Scripts" beside sentence-case headlines reads as
 * frames written by strangers. The style most headlines already use wins
 * (sentence case on a tie), and only the others are changed. Proper nouns
 * survive the change: a word the brief or the brand profile capitalises
 * mid-sentence, a day or a month, and an acronym keep their capitals.
 */

export type HeadlineCase = "title" | "sentence";

/* Words title case leaves lowercase inside a headline. */
const SMALL_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "nor",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "by",
  "with",
  "from",
  "as",
  "per",
  "via",
  "vs",
  "into",
  "onto",
  "over",
  "than",
  "so",
  "yet",
]);

const CALENDAR = new Set(
  [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].flatMap((w) => [w, `${w}s`]),
);

const isWord = (token: string) => /^\p{L}/u.test(token);
const isAcronym = (token: string) => /^\p{Lu}{2,}\b/u.test(token);
/* A capital after a small letter is the name's own spelling ("FreshFold",
   "WhatsApp", "iFresh"), never a casing choice, so no casing touches it. */
const isCamel = (token: string) => /\p{Ll}\p{Lu}/u.test(token);
/* "M-Pesa", "E-Naira": a lone capital before a hyphen spells a name. */
const isLetterName = (token: string) => /^\p{Lu}-\p{Lu}/u.test(token);
const bare = (token: string) =>
  token.toLowerCase().replace(/[^\p{L}\p{N}'’-]/gu, "");

/** The words `sources` capitalise where a sentence does not make them:
 *  the names a casing change must keep. */
export function properNouns(sources: readonly (string | null | undefined)[]) {
  const names = new Set<string>(CALENDAR);
  for (const source of sources) {
    const tokens = (source ?? "").split(/\s+/).filter(Boolean);
    tokens.forEach((token, i) => {
      const startsSentence = i === 0 || /[.!?:]$/.test(tokens[i - 1]);
      if (isCamel(token) || isLetterName(token)) names.add(bare(token));
      else if (!startsSentence && /^\p{Lu}/u.test(token)) {
        names.add(bare(token));
      }
    });
  }
  return names;
}

/** Runs of two or more capitalised words in `sources` ("Bright Path",
 *  "Lagos Design Week"), each word bare and lowercased, and the words
 *  that are capitalised only inside such a run: "Coffee" in "Kiln
 *  Coffee" is part of a name, not a name on its own. */
export function nameRuns(sources: readonly (string | null | undefined)[]): {
  runs: string[][];
  runOnly: Set<string>;
} {
  const runs: string[][] = [];
  const inRun = new Set<string>();
  const alone = new Set<string>();
  for (const source of sources) {
    const tokens = (source ?? "").split(/\s+/).filter(Boolean);
    const capped = (t: string | undefined) =>
      t !== undefined && /^\p{Lu}/u.test(t) && isWord(t);
    let run: string[] = [];
    let runOpensSentence = false;
    const close = () => {
      if (run.length >= 2) {
        runs.push(run);
        for (const w of run) inRun.add(w);
      }
      /* "Contact Ngozi Ade" opens its sentence, so its first word may be
         a verb: the name is also the run without it. Two words ("Kiln
         Coffee") are left whole, since either may be the name. */
      if (runOpensSentence && run.length >= 3) runs.push(run.slice(1));
      run = [];
    };
    tokens.forEach((token, i) => {
      const startsSentence = i === 0 || /[.!?:]$/.test(tokens[i - 1]);
      const word = bare(token);
      const leadsRun = run.length === 0 && SMALL_WORDS.has(word);
      if (capped(token) && !leadsRun) {
        if (run.length === 0) runOpensSentence = startsSentence;
        run.push(word);
        const nextOn = capped(tokens[i + 1]) && !/[.!?:,;]$/.test(token);
        if (!startsSentence && run.length === 1 && !nextOn) alone.add(word);
        if (!nextOn) close();
      } else {
        close();
      }
    });
    close();
  }
  return {
    runs,
    runOnly: new Set([...inRun].filter((w) => !alone.has(w))),
  };
}

/** Indexes, among `words`, of every word inside a run of `runs`. */
function inRuns(words: readonly string[], runs: readonly string[][]) {
  const held = new Set<number>();
  const keys = words.map(bare);
  for (const run of runs) {
    for (let i = 0; i + run.length <= keys.length; i += 1) {
      if (run.every((w, k) => keys[i + k] === w)) {
        for (let k = 0; k < run.length; k += 1) held.add(i + k);
      }
    }
  }
  return held;
}

/** The casing a headline is written in, or null when it has too few
 *  words beyond the first to tell. */
export function headlineCase(
  headline: string,
  names: ReadonlySet<string> = new Set(),
): HeadlineCase | null {
  const words = headline
    .split(/\s+/)
    .slice(1)
    .filter(
      (w) =>
        isWord(w) &&
        !SMALL_WORDS.has(bare(w)) &&
        !isAcronym(w) &&
        !isCamel(w) &&
        !names.has(bare(w)),
    );
  if (words.length < 2) return null;
  const capped = words.filter((w) => /^\p{Lu}/u.test(w)).length;
  if (capped === words.length) return "title";
  return capped === 0 ? "sentence" : null;
}

function lowered(part: string, names: ReadonlySet<string>): string {
  if (
    !isWord(part) ||
    isAcronym(part) ||
    isCamel(part) ||
    names.has(bare(part))
  ) {
    return part;
  }
  return /^\p{Lu}\p{Ll}/u.test(part) || /^\p{Lu}$/u.test(part)
    ? `${part[0].toLowerCase()}${part.slice(1)}`
    : part;
}

/* "Take-Home" in a sentence-case set reads as title case kept on half a
   word, even where it opens the headline: the parts after a hyphen follow
   the set's casing. */
function afterHyphens(token: string, names: ReadonlySet<string>): string {
  if (isLetterName(token)) return token;
  const [head, ...rest] = token.split("-");
  return [head, ...rest.map((part) => lowered(part, names))].join("-");
}

function toSentence(
  headline: string,
  names: ReadonlySet<string>,
  runs: readonly string[][] = [],
  runOnly: ReadonlySet<string> = new Set(),
): string {
  const tokens = headline.split(/(\s+)/);
  const words = tokens.filter((t) => t && !/^\s+$/.test(t));
  const held = inRuns(words, runs);
  const own = new Set([...names].filter((n) => !runOnly.has(n)));
  let count = 0;
  let sentenceStart = true;
  return tokens
    .map((token) => {
      if (/^\s+$/.test(token) || !token) return token;
      const at = count;
      const first = count === 0 || sentenceStart;
      count += 1;
      sentenceStart = /[.!?:]$/.test(token);
      if (held.has(at)) return capitalised(token);
      const tail = afterHyphens(token, own);
      if (first || own.has(bare(token))) return tail;
      return lowered(tail, own);
    })
    .join("");
}

const capitalised = (token: string) =>
  isWord(token) ? `${token[0].toUpperCase()}${token.slice(1)}` : token;

function toTitle(headline: string): string {
  const tokens = headline.split(/(\s+)/);
  let words = 0;
  return tokens
    .map((token) => {
      if (/^\s+$/.test(token) || !token) return token;
      const first = words === 0;
      words += 1;
      if (!isWord(token) || /^\p{Lu}/u.test(token)) return token;
      if (!first && SMALL_WORDS.has(bare(token))) return token;
      return `${token[0].toUpperCase()}${token.slice(1)}`;
    })
    .join("");
}

/** The set's headlines in the casing most of them use, and every card
 *  title in that casing too: "Heel Turnaround" beside "Made for office
 *  shoes" reads as two writers. */
export function withConsistentCasing(
  frames: readonly FrameBeat[],
  sources: readonly (string | null | undefined)[],
): { frames: FrameBeat[]; recased: number[]; style: HeadlineCase | null } {
  const names = properNouns(sources);
  const { runs, runOnly } = nameRuns(sources);
  /* A name's words say nothing of the casing around them: "Pour one at
     Kiln Coffee" is sentence case. */
  const own = new Set([...names].filter((n) => !runOnly.has(n)));
  const withoutRuns = (headline: string) => {
    const words = headline.split(/\s+/).filter(Boolean);
    const held = inRuns(words, runs);
    return words.filter((_, i) => i === 0 || !held.has(i)).join(" ");
  };
  const styles = frames.map((beat) =>
    headlineCase(withoutRuns(beat.headline), own),
  );
  const titles = styles.filter((s) => s === "title").length;
  const sentences = styles.filter((s) => s === "sentence").length;
  const style: HeadlineCase | null =
    titles === 0 && sentences === 0
      ? null
      : titles > sentences
        ? "title"
        : "sentence";
  if (style === null) return { frames: [...frames], recased: [], style };
  const recase = (text: string) =>
    style === "title" ? toTitle(text) : toSentence(text, names, runs, runOnly);
  const recased: number[] = [];
  const next = frames.map((beat, i) => {
    const headline =
      styles[i] === null || styles[i] === style
        ? beat.headline
        : recase(beat.headline);
    const title = recase(beat.title);
    if (headline === beat.headline && title === beat.title) return beat;
    recased.push(i);
    return { ...beat, headline, title };
  });
  return { frames: next, recased, style };
}

/** `text` in sentence case, the names `sources` give kept: how an
 *  outline's titles read beside the set's sentence-case copy. */
export function sentenceCased(
  text: string,
  sources: readonly (string | null | undefined)[],
): string {
  const { runs, runOnly } = nameRuns(sources);
  return toSentence(text, properNouns(sources), runs, runOnly);
}
