import { textsOverlap } from "@/lib/design/sequence/arc";
import type {
  ApprovedOutline,
  PlannedOutline,
  PlannedSequence,
} from "@/lib/design/sequence/contract";

/**
 * The two lanes H13 scores (rubric Addendum A). Lane AUTO approves the
 * planner's own outline untouched. Lane APPROVED replaces each point code
 * flagged weak, in frame order, with the next fact from the fixture's
 * frozen owner pool (owner-pool.ts), as an owner fixing the outline would.
 * Pure, so the harness's edits are tested, not trusted.
 */

export const LANES = ["auto", "approved"] as const;
export type Lane = (typeof LANES)[number];

/** The outline as the client sends it back, untouched: every point with
 *  the signature it was planned with. */
export function approvedAsPlanned(outline: PlannedOutline): ApprovedOutline {
  return {
    kind: outline.kind,
    points: outline.points.map(({ id, role, title, point, source, sig }) => ({
      id,
      role,
      title,
      point,
      source,
      sig,
    })),
  };
}

export interface OwnerEdit {
  id: string;
  /** The planner's point the owner replaced, in its words. */
  from: string;
  to: string;
}

/* An owner retitles the slide they rewrote: its first words, short of a
   trailing joining word. */
const TITLE_WORDS = 4;
const TRAILING =
  /\s+(?:a|an|the|and|or|of|to|in|on|for|with|by|at|is|are|we|our|your|it)$/i;

export function ownerTitle(fact: string): string {
  let title = fact
    .replace(/[.;,:].*$/, "")
    .split(/\s+/)
    .slice(0, TITLE_WORDS)
    .join(" ");
  while (TRAILING.test(title)) title = title.replace(TRAILING, "");
  return title || fact.slice(0, 40);
}

/** Lane APPROVED's outline: every flagged point, in frame order, given
 *  the owner pool's next fact as a "user" point. Points past the pool
 *  stay as planned. */
export function withOwnerPoints(
  outline: PlannedOutline,
  pool: readonly string[],
): { approved: ApprovedOutline; edits: OwnerEdit[] } {
  const edits: OwnerEdit[] = [];
  let next = 0;
  const approved = approvedAsPlanned(outline);
  approved.points = approved.points.map((p, i) => {
    const flagged = outline.points[i]?.weak !== null;
    if (!flagged || next >= pool.length) return p;
    const to = pool[next++];
    edits.push({ id: p.id, from: p.point, to });
    const { sig: _planned, ...unsigned } = p;
    return { ...unsigned, point: to, title: ownerTitle(to), source: "user" };
  });
  return { approved, edits };
}

/** Frames the judge scored at or below this for repetition must have
 *  been flagged weak (Addendum A: recall at least 0.8). */
export const LOW_REPETITION = 2;
export const FLAG_RECALL_MIN = 0.8;

export interface RecallTally {
  low: number;
  flagged: number;
  /** Null when no frame scored low. */
  recall: number | null;
  /** "case/N frame k: reason" for each low frame code did not flag. */
  missed: string[];
  /** Body points code flagged weak, of all body points scored. A flag on
   *  nearly every point passes recall by default and tells the owner
   *  nothing (O1 round-1 critic, HIGH 3). */
  bodyFlagged: number;
  bodyPoints: number;
  /** Of the flagged points the judge scored, the share it scored at or
   *  below FLAG_PRECISION_SCORE: how often a flag is right. */
  precision: number | null;
}

/* A point the judge scores 3 shares some of another frame's point or
   wording (judge.ts): a flag on it is advice the owner can use. */
export const FLAG_PRECISION_SCORE = 3;

export interface RecallInput {
  label: string;
  /** Per-frame repetition scores, 1-based frame numbers. */
  frameScores: readonly { frame: number; repetition: number }[];
  outline: PlannedOutline;
}

/** Of the frames the judge scored low for repetition in lane AUTO, how
 *  many code flagged weak in the outline; and of the body points code
 *  flagged, how many the judge scored weak too. */
export function flagRecall(runs: readonly RecallInput[]): RecallTally {
  let low = 0;
  let flagged = 0;
  let bodyFlagged = 0;
  let bodyPoints = 0;
  let flaggedWeak = 0;
  const missed: string[] = [];
  for (const run of runs) {
    const scored = new Map<number, number>();
    for (const s of run.frameScores) {
      scored.set(s.frame, Math.min(scored.get(s.frame) ?? 5, s.repetition));
    }
    for (const [frame, score] of scored) {
      const point = run.outline.points[frame - 1];
      if (!point) continue;
      if (point.role === "body") {
        bodyPoints += 1;
        if (point.weak) {
          bodyFlagged += 1;
          if (score <= FLAG_PRECISION_SCORE) flaggedWeak += 1;
        }
      }
      if (score > LOW_REPETITION) continue;
      low += 1;
      if (point.weak) flagged += 1;
      else
        missed.push(
          `${run.label} frame ${frame} (${point.role}): ${point.point}`,
        );
    }
  }
  return {
    low,
    flagged,
    recall: low === 0 ? null : flagged / low,
    missed,
    bodyFlagged,
    bodyPoints,
    precision: bodyFlagged === 0 ? null : flaggedWeak / bodyFlagged,
  };
}

/** The planner's outline with its first body point deleted, as an owner
 *  taking a slide out would, every other point sent back signed; null
 *  when the outline is already at its kind's fewest points. */
export function withPointDeleted(
  outline: PlannedOutline,
  min: number,
): { approved: ApprovedOutline; deleted: OwnerEdit } | null {
  if (outline.points.length - 1 < min) return null;
  const at = outline.points.findIndex((p) => p.role === "body");
  if (at < 0) return null;
  const approved = approvedAsPlanned(outline);
  const [gone] = approved.points.splice(at, 1);
  return {
    approved,
    deleted: { id: gone.id, from: gone.point, to: "" },
  };
}

/** The replaced points a delivered frame still makes: what the owner
 *  took out and the set says anyway (O5). A frame whose own approved
 *  point shares those words is making its own point, not the removed
 *  one; words every frame may share (`free`) do not count. */
export function deletedLeaks(
  plan: PlannedSequence,
  approved: ApprovedOutline,
  edits: readonly OwnerEdit[],
  free: ReadonlySet<string> = new Set(),
): string[] {
  return edits.flatMap((edit) =>
    plan.frames.flatMap((beat, i) => {
      const own = approved.points[i]?.point ?? "";
      const says = [beat.headline, beat.subheadline].some(
        (line) =>
          line &&
          textsOverlap(line, edit.from, free) &&
          !textsOverlap(line, own, free),
      );
      return says ? [`frame ${i + 1} still says "${edit.from}"`] : [];
    }),
  );
}
