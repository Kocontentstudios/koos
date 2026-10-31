import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import type { BriefFact } from "@/lib/jobs/directions/brief-facts";
import { type ArcPoint, claimsOverlap, textsOverlap } from "./arc";
import type { ApprovedOutline, FrameBeat } from "./contract";
import type { CopyFault } from "./faults";
import { factsIn } from "./outline-arc";
import { PROFILE_POINT_FIELDS, profileClauses } from "./points";

/**
 * What the owner took out of an outline (O5: nothing from a deleted point
 * appears). Not sending a point is not enough: the copy model still reads
 * the brand profile and the whole brief, and wrote "taught by a working
 * software engineer" onto a frame after the owner deleted that point (O1
 * round-1 critic, HIGH 5). So code names what was removed, takes it out of
 * the profile the model reads, and finds and cuts it on the set.
 */

/** The points the planner would offer that no approved point makes:
 *  every pool point the owner deleted or replaced. */
export function removedPoints(
  outline: ApprovedOutline,
  pool: readonly ArcPoint[],
  facts: readonly BriefFact[],
  free: ReadonlySet<string> = new Set(),
): ArcPoint[] {
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
    const lines = [beat.headline, ...beat.subheadline.split(SENTENCE_BREAK)];
    const said = lines
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
