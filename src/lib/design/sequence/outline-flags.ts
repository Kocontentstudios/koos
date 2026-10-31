import type { BriefFact } from "@/lib/jobs/directions/brief-facts";
import type { OutlinePoint, SequenceKind } from "./contract";

export interface OutlineFlagContext {
  kind: SequenceKind;
  /** The brief's facts the outline was planned against (sequenceFacts). */
  facts: readonly BriefFact[];
  /** Words every point may share: the brand's and the offering's names
   *  (namesFree). */
  free: ReadonlySet<string>;
}

/**
 * The points with `weak` set by code, never by a model. Pure and
 * deterministic; one flag per point, first match wins:
 *  - overlap: the point makes an earlier point's point (claimsOverlap);
 *    overlapsWith names the earlier id;
 *  - filler: a body point whose only content is who it is for, when or
 *    where (audience, date, day, time, place);
 *  - profile-fill: a body point drawn from the brand profile because the
 *    brief ran out. Never set on a "user" point.
 * The hook and the action are never flagged filler: a date or place is the
 * action's job.
 */
export function flagOutline(
  _points: readonly Omit<OutlinePoint, "weak">[],
  _ctx: OutlineFlagContext,
): OutlinePoint[] {
  throw new Error("flagOutline: not implemented");
}
