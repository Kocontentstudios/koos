import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import {
  type BriefFact,
  factStated,
  numbersIn,
} from "@/lib/jobs/directions/brief-facts";
import { type ArcPoint, claimsOverlap, textsOverlap } from "./arc";
import type { ApprovedOutline, FrameBeat } from "./contract";
import type { CopyFault } from "./faults";
import { factsIn } from "./outline-arc";
import { PROFILE_POINT_FIELDS, profileClauses } from "./points";

/**
 * What the owner took out of an outline (O5: nothing from a deleted point
 * appears). Not sending a point is not enough: the copy model still reads
 * the brand profile and the whole brief, and wrote "taught by a working
 * software engineer" onto a frame after the owner deleted that point. So
 * code names what was removed, takes it out of the profile the model
 * reads, and finds and cuts it on the set, footers and button included.
 */

/** The points the planner would offer that no approved point makes:
 *  every pool point the owner deleted or replaced. None when the outline
 *  comes back as planned (outlineEdited). */
export function removedPoints(
  outline: ApprovedOutline,
  pool: readonly ArcPoint[],
  facts: readonly BriefFact[],
  free: ReadonlySet<string> = new Set(),
): ArcPoint[] {
  /* Approved as planned, the pool points the planner left unused were
     never the owner's to take out: they are spare, and a frame may still
     be given one in place of a point another frame makes. */
  if (!outlineEdited(outline)) return [];
  const approved = outline.points.map((p) => ({
    text: p.point,
    facts: factsIn(p.point, facts),
  }));
  return pool.filter(
    (candidate) =>
      candidate.text.trim() &&
      !approved.some((a) => claimsOverlap(a, candidate, facts, free)),
  );
}

/** The removed points the copy model still reads in the brief, which it
 *  must be told to leave out; a profile point is taken out of the profile
 *  it reads instead, and naming it would put it back in front of it. */
export const removedFromBrief = (removed: readonly ArcPoint[]): string[] =>
  removed
    .filter((p) => p.source === "brief" || p.source === "fact")
    .map((p) => p.text);

/** The brand profile without the clauses the owner removed, for every
 *  prompt the set's copy is written from. */
export function profileWithout(
  brand: BrandSummary,
  removed: readonly string[],
  free: ReadonlySet<string> = new Set(),
): BrandSummary {
  if (removed.length === 0) return brand;
  const next: BrandSummary = { ...brand };
  for (const field of PROFILE_POINT_FIELDS) {
    const text = brand[field]?.trim();
    if (!text) continue;
    const kept = profileClauses(text).filter(
      (clause) => !removed.some((r) => textsOverlap(clause, r, free)),
    );
    next[field] = kept.length > 0 ? kept.join("; ") : null;
  }
  return next;
}

const SENTENCE_BREAK = /(?<=[.!?])\s+(?=\S)/;

/* faults.ts's MAJOR: setFaults imports this module, so the weight is not
   imported back. */
const BLOCKING = 3;

/** The removed point a line makes, unless the frame's own point makes it
 *  too (an owner's point may share words with what it replaced). */
export function removedSaidBy(
  line: string,
  removed: readonly string[],
  own: string,
  free: ReadonlySet<string>,
): string | null {
  if (!line.trim()) return null;
  return (
    removed.find(
      (r) => textsOverlap(line, r, free) && !textsOverlap(line, own, free),
    ) ?? null
  );
}

/** Every line of a frame a reader sees, footer items and the button
 *  included: a removed point drawn in small print is still said. */
export function linesOf(beat: FrameBeat): string[] {
  return [
    beat.headline,
    ...beat.subheadline.split(SENTENCE_BREAK),
    ...beat.footerLines.flatMap((line) => line.split(FOOTER_ITEM)),
    beat.cta,
  ].filter((line) => line.trim());
}

const FOOTER_ITEM = /\s+·\s+/;

/** Frames that still make a point the owner took out. Blocking. */
export function removedFaults(
  frames: readonly FrameBeat[],
  removed: readonly string[],
  claims: readonly string[],
  free: ReadonlySet<string>,
): CopyFault[] {
  if (removed.length === 0) return [];
  return frames.flatMap((beat, frame) => {
    const own = claims[frame] ?? "";
    const said = linesOf(beat)
      .map((line) => removedSaidBy(line, removed, own, free))
      .find((r): r is string => r !== null);
    return said
      ? [
          {
            frame,
            field: "frame" as const,
            detail: `it says a point the owner took out ("${said}"); say only this frame's own claim`,
            weight: BLOCKING,
          },
        ]
      : [];
  });
}

/**
 * Whether the outline is not the one the planner sent: a point the owner
 * wrote, or a planned point missing (ids are planned in order, p1 to pN,
 * and the hook and action cannot be deleted, so a deletion leaves a gap).
 */
export function outlineEdited(outline: ApprovedOutline): boolean {
  return outline.points.some(
    (p, i) => p.source === "user" || p.id !== `p${i + 1}`,
  );
}

/* Whether the owner's words change a fact rather than leave it out: they
   give one of its figures ("5am to 11pm" over the brief's "5am to
   10pm"). */
function correctsFact(text: string, fact: BriefFact): boolean {
  const figures = numbersIn(fact.text);
  if (figures.size === 0) return false;
  const given = numbersIn(text);
  return [...figures].some((n) => given.has(n));
}

/**
 * The brief facts the owner took out, by index: facts no approved point
 * states that a point the owner deleted or replaced carried, or that the
 * owner's own words correct. H5 asks every brief fact on some frame; O5
 * says nothing the owner removed appears. The approved outline is the
 * owner's decision, so O5 wins: these facts are neither required nor
 * drawn by code, and a frame that states one is at fault. An outline the
 * owner did not touch releases nothing, so the planner's own outline is
 * held to every fact.
 */
export function releasedFacts(
  outline: ApprovedOutline,
  planned: readonly ArcPoint[],
  facts: readonly BriefFact[],
  free: ReadonlySet<string> = new Set(),
): number[] {
  if (!outlineEdited(outline)) return [];
  const approved = outline.points.map((p) => ({
    text: p.point,
    facts: factsIn(p.point, facts),
    owner: p.source === "user",
  }));
  const stated = new Set(approved.flatMap((a) => a.facts));
  const owners = approved.filter((a) => a.owner);
  const removed = removedPoints(outline, planned, facts, free);
  return facts.flatMap((fact, n) => {
    if (fact.kind === "product" || stated.has(n)) return [];
    const carried = planned.filter((p) => p.facts.includes(n));
    const dropped = carried.some(
      (p) =>
        removed.includes(p) ||
        owners.some((o) => claimsOverlap(o, p, facts, free)),
    );
    const corrected = owners.some((o) => correctsFact(o.text, fact));
    return dropped || corrected ? [n] : [];
  });
}

/** The released facts no frame may state. */
export function unsayable(
  facts: readonly BriefFact[],
  released: readonly string[],
  owned: readonly string[] = [],
): BriefFact[] {
  return facts.filter(
    (f) =>
      released.includes(f.text) &&
      (!SAYABLE.has(f.kind) || owned.some((o) => o && correctsFact(o, f))),
  );
}

const SAYABLE = new Set<BriefFact["kind"]>([
  "date",
  "day",
  "time",
  "place",
  "contact",
]);

/** Frames that state a fact the owner took out (releasedFacts). Blocking:
 *  the brief still holds it, so the copy model may write it anyway. */
export function releasedFaults(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  released: readonly string[],
  owned: readonly string[] = [],
): CopyFault[] {
  if (released.length === 0) return [];
  /* A when or where the owner dropped with a point may still be said: the
     hook dates its news and the action says where. A figure the owner
     corrected, and any claim they dropped, may not. */
  const gone = unsayable(facts, released, owned);
  return frames.flatMap((beat, frame) => {
    const said = gone.find((fact) =>
      linesOf(beat).some((line) => factStated(fact, line)),
    );
    return said
      ? [
          {
            frame,
            field: "frame" as const,
            detail: `it states "${said.text}", which the owner took out of the outline; leave it out`,
            weight: BLOCKING,
          },
        ]
      : [];
  });
}
