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
 *    two words are left ("Still writing invoices by hand?").
 * Code only removes words here; it never writes one.
 */
export function withoutStatement(
  beat: Pick<FrameBeat, "headline" | "subheadline" | "footerLines">,
  statement: string,
): Partial<FrameBeat> | null {
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
