import { type BriefFact, factStated } from "@/lib/jobs/directions/brief-facts";
import { upperFirst } from "./casing";

/**
 * The brief's words to the designer rather than to the reader: a labelled
 * note ("Audience: young professionals in Yaba", "Tone: warm") and the
 * piece's own lead ("A short deck for office managers in Lagos:"). They
 * shape every frame through the prompt; quoted on a slide they are the
 * owner talking to the designer (C6), and on a hook they open the set on
 * a line no reader was meant to see (integration round 2, HIGH 1 and 2).
 */

/* Who the piece is for. A note under one of these labels describes the
   reader, so a point drawn from it tells the reader who they are, not what
   they get. */
const AUDIENCE_LABEL =
  /^(?:(?:target|intended|core|primary)\s+)?(?:audience|market|customers?|readers?|demographic|persona)s?$|^(?:target|for|who(?:\s+it'?s\s+for)?)$/i;

/* Labels a brief uses for instructions about the piece itself. */
const INSTRUCTION_LABEL =
  /^(?:tone(?:\s+of\s+voice)?|voice|goal|goals|objective|aim|purpose|style|vibe|mood|look(?:\s+and\s+feel)?|feel|notes?|note\s+to\s+designer|designer\s+notes?|format|platform|channel|deadline|due|colou?rs?|brand\s+colou?rs?|palette|fonts?|typography|budget|size|dimensions?|cta|call\s+to\s+action|key\s+message|message|brief|deliverables?|kpi|kpis)$/i;

/* "Label: rest", with the label at most four words; the colon must be
   followed by a space so "12:30" and "https:" are never read as one. */
const LABEL_LEAD = /^\s*([\p{L}][\p{L}' ]{0,40}?)\s*:\s+(?=\S)/u;

export type NoteKind = "audience" | "instruction";

/** Which kind of designer note `text` opens with, or null. */
export function designerNoteKind(text: string): NoteKind | null {
  const label = LABEL_LEAD.exec(text)?.[1]?.trim();
  if (!label || label.split(/\s+/).length > 4) return null;
  if (AUDIENCE_LABEL.test(label)) return "audience";
  if (INSTRUCTION_LABEL.test(label)) return "instruction";
  return null;
}

/** Whether `text` opens on a label the brief gives the designer
 *  ("Audience:", "Tone:"). */
export function opensOnDesignerNote(text: string): boolean {
  return designerNoteKind(text) !== null;
}

/** `text` with a designer-note label taken off ("Audience: young
 *  professionals" is "Young professionals"); `text` as it was otherwise. */
export function withoutNoteLabel(text: string): string {
  if (!opensOnDesignerNote(text)) return text;
  return upperFirst(text.replace(LABEL_LEAD, ""));
}

/* The brief's words about the piece itself, before what the piece says:
   "A short deck for office managers in Lagos: Lumen Coffee now supplies
   offices" and "Sponsorship deck for Lagos Design Week 2026, 4 to 8
   December". Without a colon only "<piece> for|about|on" goes: "A deck to
   pitch offices" would leave an order. */
const PIECE_LEAD_TO_COLON =
  /^(?:(?:an?|the|our|this)\s+)?(?:[\p{L}-]+\s+){0,2}(?:deck|carousel|presentation|slides?|post|reel|flyer|poster)\s+(?:for|about|on|to)\b[^:.!?]{0,80}:\s+(?=\S)/iu;
const PIECE_LEAD =
  /^(?:(?:an?|the|our|this)\s+)?(?:[\p{L}-]+\s+){0,2}(?:deck|carousel|presentation|slides?|post|reel|flyer|poster)\s+(?:for|about|on)\s+(?=\S)/iu;

export function withoutPieceLead(sentence: string): string {
  const rest = sentence
    .replace(PIECE_LEAD_TO_COLON, "")
    .replace(PIECE_LEAD, "");
  return rest === sentence ? sentence : upperFirst(rest);
}

/** The words a piece lead takes off a sentence ("A short deck for office
 *  managers in Lagos:"), or "". */
export function pieceLeadOf(sentence: string): string {
  const rest = withoutPieceLead(sentence);
  if (rest === sentence) return "";
  return sentence.slice(0, sentence.length - rest.length);
}

const sentencesOfBrief = (briefText: string) =>
  briefText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** The brief's notes to the designer, whole sentences, label and all. */
export function designerNotes(briefText: string): string[] {
  return sentencesOfBrief(briefText).filter(opensOnDesignerNote);
}

/** The brief's notes on who the piece is for, label taken off: what an
 *  outline point drawn from one only says (fillerReason). */
export function audienceNotes(briefText: string): string[] {
  return sentencesOfBrief(briefText)
    .filter((s) => designerNoteKind(s) === "audience")
    .map(withoutNoteLabel);
}

/** The brief as the reader's copy may draw on it: every designer note
 *  out, and every piece lead off its sentence. */
export function readerBrief(briefText: string): string {
  return sentencesOfBrief(briefText)
    .filter((s) => !opensOnDesignerNote(s))
    .map(withoutPieceLead)
    .join(" ");
}

/** The brief's words only the designer was meant to read: its notes and
 *  its piece leads. */
export function designerWords(briefText: string): string {
  return sentencesOfBrief(briefText)
    .flatMap((s) =>
      opensOnDesignerNote(s) ? [s] : pieceLeadOf(s) ? [pieceLeadOf(s)] : [],
    )
    .join(" ");
}

/** Whether the brief gives `fact` only in words to the designer ("office
 *  managers in Lagos" of "A short deck for office managers in Lagos:"):
 *  it says who the piece is for, not something the reader is told, so no
 *  frame or point has to carry it. */
export function onlyForDesigner(fact: BriefFact, briefText: string): boolean {
  return (
    factStated(fact, designerWords(briefText)) &&
    !factStated(fact, readerBrief(briefText))
  );
}
