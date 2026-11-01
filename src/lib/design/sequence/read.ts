import { hookNames } from "@/lib/ai/prompts/design-sequence";
import type { DesignContext } from "@/lib/design/context";
import { brandFacts } from "@/lib/jobs/directions/brief";
import { type BriefFact, brandRegion } from "@/lib/jobs/directions/brief-facts";
import {
  type BriefReader,
  readBriefWithModel,
  settleBriefRead,
} from "@/lib/jobs/directions/brief-read";
import { actionPrices } from "./arc";
import { FRAME_BOUNDS, type SequenceKind } from "./contract";
import { onlyForDesigner } from "./designer-note";
import { namesFree } from "./hook";
import { sequenceFacts } from "./ledger";

/* A brief read can take the piece for the offering ("Investor deck"):
   the hook is then told to name it, and talks about the deck instead of
   what the deck is about. Only a phrase whose head is the piece itself:
   "Desk posts" or "Slides and sandals" can be what a brand sells. */
const NAMES_THE_PIECE =
  /^(?:(?:an?|the|our|this)\s+)?(?:[\p{L}-]+\s+){0,2}(?:deck|presentation|carousel)$/iu;

/* An offering is a thing the brand sells. A read ending on a pronoun
   ("replaces it", from "Fixit Hub replaces it the same day") is a verb
   phrase cut from a sentence about the offer: a hook told to name it says
   "Hub replaces it". */
const NOT_A_THING =
  /\b(?:it|them|this|that|these|those|you|us|me|him|her|one)$/i;

const isThing = (phrase: string | null | undefined) =>
  Boolean(phrase?.trim()) && !NOT_A_THING.test(phrase?.trim() ?? "");

/**
 * The offering widened over the names the brief writes in front of it:
 * a read of "maths crash course" from "WAEC maths crash course" left the
 * hook free to drop the exam it is for. An
 * acronym always joins; a capitalised word joins only mid-sentence, so
 * "Our" or "Launch" opening a sentence never does. A word of the brand's
 * own name never joins: the hook names the brand on its own, and half of
 * it ("Hub" of "Fixit Hub") is no name at all.
 */
export function widenedOffering(
  offering: string | null,
  briefText: string,
  brandName = "",
): string | null {
  if (!offering?.trim()) return offering;
  const at = briefText.toLowerCase().indexOf(offering.toLowerCase());
  if (at < 0) return offering;
  const before = briefText.slice(0, at).split(/(\s+)/);
  const brandWords = new Set(
    brandName
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter(Boolean),
  );
  const words: string[] = [];
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const token = before[i];
    if (!token) continue;
    if (/^\s+$/.test(token)) continue;
    const previous = before
      .slice(0, i)
      .reverse()
      .find((t) => t && !/^\s+$/.test(t));
    const opensSentence = previous === undefined || /[.!?:]$/.test(previous);
    const acronym = /^\p{Lu}[\p{Lu}\d]+$/u.test(token);
    const name = /^\p{Lu}[\p{L}\d-]*$/u.test(token) && !opensSentence;
    if (!acronym && !name) break;
    if (brandWords.has(token.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))) {
      break;
    }
    words.unshift(token);
  }
  const original = briefText.slice(at, at + offering.length);
  return words.length > 0 ? `${words.join(" ")} ${original}` : offering;
}

/** The offering a set names on its hook: the read's phrase widened over
 *  the names before it, or null when the phrase names the piece itself or
 *  is no thing at all. */
export function settledOffering(
  phrase: string | null,
  briefText: string,
  brandName: string,
): string | null {
  if (!phrase || NAMES_THE_PIECE.test(phrase.trim()) || !isThing(phrase)) {
    return null;
  }
  return widenedOffering(phrase, briefText, brandName);
}

/** What a set is held to, read once from the brief. */
export interface SequenceBrief {
  briefText: string;
  brandName: string;
  facts: BriefFact[];
  offering: string | null;
  /** Index of the offering's own fact in `facts`, or -1. */
  offeringIndex: number;
  /** What the hook must name (hookNames). */
  names: string[];
  /** Words every frame may share (namesFree). */
  free: Set<string>;
  /** Prices the action frame states (actionPrices). */
  atAction: Set<number>;
  /** Whether the model read came back; false is the regex read alone. */
  readAvailable: boolean;
}

/* A model error carries the answer's text, which is the client's copy:
   its name and message say what failed without putting a brief in a log. */
export const failure = (err: unknown) => ({
  name: (err as Error)?.name,
  message: String((err as Error)?.message ?? err).slice(0, 300),
});

/**
 * The brief read the way the directions path reads it (readBriefWithModel,
 * settleBriefRead, sequenceFacts), so an outline, its set and a single
 * design are held to the same facts. One model call; a failed read falls
 * back to the regex read rather than failing the set.
 */
export async function readSequenceBrief(
  context: DesignContext,
  kind: SequenceKind,
  briefReader: BriefReader = readBriefWithModel,
): Promise<SequenceBrief> {
  const briefText = context.briefText ?? "";
  const raw = await briefReader({
    briefText,
    title: context.title ?? "",
  }).catch((err) => {
    console.error("sequence brief read failed", failure(err));
    return null;
  });
  const read = settleBriefRead(
    raw,
    briefText,
    brandRegion([
      ...brandFacts(context.brandSummary),
      context.brandSummary.websiteUrl,
    ]),
  );
  const brandName = context.brandSummary.name;
  /* A fact only the brief's note to the designer gives ("Audience: young
     professionals in Yaba and Surulere") is not the reader's to be told,
     so no frame is held to it. */
  const facts = sequenceFacts(read, brandName, briefText).filter(
    (f) =>
      (f.kind !== "product" ||
        (!NAMES_THE_PIECE.test(f.text.trim()) && isThing(f.text))) &&
      (f.kind === "product" || !onlyForDesigner(f, briefText)),
  );
  const offering = settledOffering(
    read.offering?.phrase ?? null,
    briefText,
    brandName,
  );
  return {
    briefText,
    brandName,
    facts,
    offering,
    offeringIndex: facts.findIndex((f) => f.kind === "product"),
    names: hookNames(context, offering),
    free: namesFree(brandName, offering),
    atAction: actionPrices(facts, kind, briefText),
    readAvailable: read.available,
  };
}

/** Why a frame count is refused, naming the count that was given, or
 *  null for a count within FRAME_BOUNDS. */
export function frameCountError(
  caller: string,
  kind: SequenceKind,
  got: unknown,
): string | null {
  const { min, max } = FRAME_BOUNDS[kind];
  if (
    typeof got === "number" &&
    Number.isInteger(got) &&
    got >= min &&
    got <= max
  ) {
    return null;
  }
  return `${caller}: a ${kind} takes ${min} to ${max} frames; got ${typeof got === "number" ? String(got) : JSON.stringify(got)}. Clamp the count with clampFrameCount first.`;
}
