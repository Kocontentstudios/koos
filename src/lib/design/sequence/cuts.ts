import { type BriefFact, isFragment } from "@/lib/jobs/directions/brief-facts";
import type { FrameBeat } from "./contract";
import { stillSays } from "./faults";
import { withoutFactWords } from "./repeats";

/* Sentence breaks inside a subheadline: "Repotted free. No appointment
   needed." is two statements, and only one of them may be unsourced. */
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=\S)|\s+[—–]\s+/;

const says = (field: string, text: string) =>
  stillSays({ headline: field, subheadline: "", footerLines: [] }, text);

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

const capitalised = (text: string) =>
  text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;

/** `text` with the words of `statement` taken out where they stand whole
 *  and the rest still reads, else null. */
function withoutWords(text: string, statement: string): string | null {
  const phrase: BriefFact = { kind: "condition", text: statement, needs: [] };
  const cut = withoutFactWords(text, phrase)?.trim();
  if (!cut) return cut === "" ? "" : null;
  const close = /[?!.]$/.exec(text.trim())?.[0] ?? "";
  return capitalised(/[?!.]$/.test(cut) ? cut : `${cut}${close}`);
}

/**
 * The change that takes a statement no source gives off a frame, or null
 * when no cut leaves the field readable:
 *  - a footer line that says it is dropped;
 *  - in the subheadline, the sentence that says it, where another is
 *    left. Words cut from inside a sentence leave it broken ("teeth
 *    whitening that."), and a frame left with a headline alone reads as
 *    filler, so a lone sentence stays and is reported;
 *  - in the headline, its words where they open or close it and at least
 *    two words are left ("Still writing invoices by hand?");
 *  - first of all, a soft claim word ("fresh", "now") taken out of every
 *    field that says it (withoutSoftClaim), where each still reads.
 * Code only removes words here; it never writes one.
 */
export function withoutStatement(
  beat: Pick<FrameBeat, "headline" | "subheadline" | "footerLines"> &
    Partial<Pick<FrameBeat, "cta">>,
  statement: string,
): Partial<FrameBeat> | null {
  const soft = withoutSoftClaim(beat, statement);
  if (soft) return soft;
  const line = beat.footerLines.findIndex((l) => says(l, statement));
  if (line >= 0) {
    return { footerLines: beat.footerLines.filter((_, i) => i !== line) };
  }
  if (says(beat.subheadline, statement)) {
    const sentences = beat.subheadline.split(SENTENCE_BREAK);
    const kept = sentences.filter((s) => !says(s, statement));
    if (kept.length === 0 || kept.length === sentences.length) return null;
    const rest = capitalised(kept.join(" ").trim());
    return { subheadline: /[.!?]$/.test(rest) ? rest : `${rest}.` };
  }
  if (says(beat.headline, statement) && atAnEdge(beat.headline, statement)) {
    const cut = withoutWords(beat.headline, statement);
    return cut &&
      wordCount(cut) >= 2 &&
      !isFragment(cut) &&
      !says(cut, statement)
      ? { headline: cut }
      : null;
  }
  return null;
}

/* Words that add a claim (freshness, timing, novelty) and nothing a
   sentence needs to stand: "Get your fresh bottle now" reads whole as
   "Get your bottle". A regenerate refused twice over "fresh" and "now"
   gave the user nothing (arc round-4 critic, MEDIUM 5). */
const SOFT_WORDS = new Set([
  "fresh",
  "freshly",
  "now",
  "today",
  "tonight",
  "new",
  "brand-new",
  "just",
]);

/** `text` without the soft word `word`, tidied, or null when it does not
 *  stand alone in `text`. */
function withoutSoftWord(text: string, word: string): string | null {
  const pattern = new RegExp(
    `(^|[\\s(])${word.replace(/[-]/g, "\\-")}(?=[\\s.,!?;:)]|$)`,
    "gi",
  );
  if (!pattern.test(text)) return null;
  const cut = text
    .replace(pattern, "$1")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/^[\s,;:]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return capitalised(cut);
}

/**
 * The frame with a soft claim word (SOFT_WORDS) taken out of every field
 * that says it, when each field still reads: a headline of two words or
 * more and no fragment, a button of one word or more. Null otherwise.
 */
export function withoutSoftClaim(
  beat: Pick<FrameBeat, "headline" | "subheadline" | "footerLines"> &
    Partial<Pick<FrameBeat, "cta">>,
  statement: string,
): Partial<FrameBeat> | null {
  const word = statement.trim().toLowerCase();
  if (!SOFT_WORDS.has(word)) return null;
  const change: Partial<FrameBeat> = {};
  for (const field of ["headline", "subheadline", "cta"] as const) {
    const text = beat[field];
    if (!text) continue;
    const cut = withoutSoftWord(text, word);
    if (cut === null) continue;
    const least = field === "headline" ? 2 : 1;
    if (wordCount(cut) < least || (field === "headline" && isFragment(cut))) {
      return null;
    }
    change[field] = cut;
  }
  const lines = beat.footerLines.map((l) => withoutSoftWord(l, word) ?? l);
  if (lines.some((l, i) => l !== beat.footerLines[i])) {
    change.footerLines = lines.filter((l) => wordCount(l) > 0);
  }
  return Object.keys(change).length > 0 ? change : null;
}

/** Whether `statement` opens or closes `text`, past its punctuation. */
function atAnEdge(text: string, statement: string): boolean {
  const flat = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const whole = flat(text);
  const part = flat(statement);
  return part.length > 0 && (whole.startsWith(part) || whole.endsWith(part));
}
