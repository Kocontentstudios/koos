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
import { namesFree } from "./hook";
import { sequenceFacts } from "./ledger";

/* A brief read can take the piece for the offering ("Investor deck"):
   the hook is then told to name it, and talks about the deck instead of
   what the deck is about. Only a phrase whose head is the piece itself:
   "Desk posts" or "Slides and sandals" can be what a brand sells. */
const NAMES_THE_PIECE =
  /^(?:(?:an?|the|our|this)\s+)?(?:[\p{L}-]+\s+){0,2}(?:deck|presentation|carousel)$/iu;

/**
 * The offering widened over the names the brief writes in front of it:
 * a read of "maths crash course" from "WAEC maths crash course" left the
 * hook free to drop the exam it is for (O1 round-1 critic, MEDIUM 8). An
 * acronym always joins; a capitalised word joins only mid-sentence, so
 * "Our" or "Launch" opening a sentence never does.
 */
export function widenedOffering(
  offering: string | null,
  briefText: string,
): string | null {
  if (!offering?.trim()) return offering;
  const at = briefText.toLowerCase().indexOf(offering.toLowerCase());
  if (at < 0) return offering;
  const before = briefText.slice(0, at).split(/(\s+)/);
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
    words.unshift(token);
  }
  const original = briefText.slice(at, at + offering.length);
  return words.length > 0 ? `${words.join(" ")} ${original}` : offering;
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
  const facts = sequenceFacts(read, brandName, briefText).filter(
    (f) => f.kind !== "product" || !NAMES_THE_PIECE.test(f.text.trim()),
  );
  const readOffering = read.offering?.phrase ?? null;
  const offering =
    readOffering && NAMES_THE_PIECE.test(readOffering.trim())
      ? null
      : widenedOffering(readOffering, briefText);
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

/** Why a frame count was refused, naming the count that was given. */
export function frameCountError(
  caller: string,
  kind: SequenceKind,
  got: unknown,
): string {
  const { min, max } = FRAME_BOUNDS[kind];
  return `${caller}: a ${kind} takes ${min} to ${max} frames; got ${typeof got === "number" ? String(got) : JSON.stringify(got)}. Clamp the count with clampFrameCount first.`;
}
