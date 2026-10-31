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
      if (!startsSentence && /^\p{Lu}/u.test(token)) names.add(bare(token));
    });
  }
  return names;
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
        !names.has(bare(w)),
    );
  if (words.length < 2) return null;
  const capped = words.filter((w) => /^\p{Lu}/u.test(w)).length;
  if (capped === words.length) return "title";
  return capped === 0 ? "sentence" : null;
}

function lowered(part: string, names: ReadonlySet<string>): string {
  if (!isWord(part) || isAcronym(part) || names.has(bare(part))) return part;
  return /^\p{Lu}\p{Ll}/u.test(part) || /^\p{Lu}$/u.test(part)
    ? `${part[0].toLowerCase()}${part.slice(1)}`
    : part;
}

/* "Take-Home" in a sentence-case set reads as title case kept on half a
   word, even where it opens the headline: the parts after a hyphen follow
   the set's casing. */
function afterHyphens(token: string, names: ReadonlySet<string>): string {
  const [head, ...rest] = token.split("-");
  return [head, ...rest.map((part) => lowered(part, names))].join("-");
}

function toSentence(headline: string, names: ReadonlySet<string>): string {
  const tokens = headline.split(/(\s+)/);
  let words = 0;
  let sentenceStart = true;
  return tokens
    .map((token) => {
      if (/^\s+$/.test(token) || !token) return token;
      const first = words === 0 || sentenceStart;
      words += 1;
      sentenceStart = /[.!?:]$/.test(token);
      const tail = afterHyphens(token, names);
      if (first || names.has(bare(token))) return tail;
      return lowered(tail, names);
    })
    .join("");
}

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
  const styles = frames.map((beat) => headlineCase(beat.headline, names));
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
    style === "title" ? toTitle(text) : toSentence(text, names);
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
