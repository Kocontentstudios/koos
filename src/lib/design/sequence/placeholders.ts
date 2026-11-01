import type { BriefFact } from "@/lib/jobs/directions/brief-facts";
import { type ArcPoint, claimsOverlap } from "./arc";
import { type ApprovedOutline, FRAME_BOUNDS } from "./contract";
import { EMPTY_POINT, factsIn } from "./outline-arc";
import { stopsMidPhrase } from "./phrase";
import { outlineEdited, removedPoints } from "./removed";

/**
 * An "Add a point" slide the owner approved untouched (EMPTY_POINT) has no
 * claim of its own, and a writer told to fill it fills it with what no
 * source gives ("We work through every moving part", "Stiff pedals become
 * smooth again"). Before any copy is written, code settles each one
 * (rubric Addendum C, C5):
 *  - a sourced pool point no approved point makes takes the slide, in the
 *    brief's or profile's own words;
 *  - else the slide is dropped, while the set stays within FRAME_BOUNDS,
 *    and the drop is reported with the set.
 */

export interface SettledPlaceholders {
  outline: ApprovedOutline;
  /** By point of the settled outline, its index in the approved one. */
  origin: number[];
  /** Indexes, in the approved outline, of the slides dropped. */
  dropped: number[];
  /** "point k: what it became", in order. */
  applied: string[];
}

const isPlaceholder = (text: string) => text.trim() === EMPTY_POINT;

export function settlePlaceholders(
  outline: ApprovedOutline,
  pool: readonly ArcPoint[],
  facts: readonly BriefFact[],
  free: ReadonlySet<string> = new Set(),
): SettledPlaceholders {
  /* A point the owner deleted is never handed back to a placeholder: once
     the owner has edited the outline, every unused pool point is one they
     took out (removedPoints). */
  const removed = new Set(
    removedPoints(outline, pool, facts, free).map((p) => p.text),
  );
  const points = outline.points.map((p) => ({ ...p }));
  const applied: string[] = [];
  const taken = () =>
    points
      .filter((p) => !isPlaceholder(p.point))
      .map((p) => ({ text: p.point, facts: factsIn(p.point, facts) }));
  points.forEach((point, i) => {
    if (point.role !== "body" || !isPlaceholder(point.point)) return;
    const spare = pool.find(
      (candidate) =>
        candidate.text.trim() &&
        !removed.has(candidate.text) &&
        !stopsMidPhrase(candidate.text) &&
        !taken().some((t) => claimsOverlap(t, candidate, facts, free)),
    );
    if (!spare) return;
    points[i] = {
      ...point,
      point: spare.text,
      source:
        spare.source === "profile" || spare.source === "value"
          ? "profile"
          : "brief",
    };
    applied.push(`point ${i + 1}: given the unused point "${spare.text}"`);
  });
  const min = FRAME_BOUNDS[outline.kind].min;
  const dropped: number[] = [];
  let count = points.length;
  points.forEach((point, i) => {
    if (point.role !== "body" || !isPlaceholder(point.point)) return;
    if (count <= min) return;
    dropped.push(i);
    count -= 1;
    applied.push(`point ${i + 1}: left as "Add a point", dropped`);
  });
  const origin = points.flatMap((_, i) => (dropped.includes(i) ? [] : [i]));
  /* A dropped placeholder is not an owner's deletion: an outline the owner
     left as planned keeps reading as planned (outlineEdited), ids in
     order. */
  const asPlanned = !outlineEdited(outline);
  return {
    outline: {
      ...outline,
      points: origin.map((i, k) =>
        asPlanned ? { ...points[i], id: `p${k + 1}` } : points[i],
      ),
    },
    origin,
    dropped,
    applied,
  };
}
