import {
  type BriefFact,
  factStated,
  numbersIn,
} from "@/lib/jobs/directions/brief-facts";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import type { ArcPoint, PointSource } from "./arc";
import type { ApprovedOutline, FrameBeat, OutlineSource } from "./contract";
import type { ArcAnswer } from "./schema";

/* A body frame no point was left for still needs words the owner can
   replace: a prompt to them, which the outline flags as filler. Approved
   as it is, the frame is written to no claim of its own, never to these
   words. */
export const EMPTY_POINT =
  "Nothing in the brief or profile is left for this slide; write its point.";

const isEmptyPoint = (text: string) => text.trim() === EMPTY_POINT;

const POINT_SOURCE: Record<OutlineSource, PointSource> = {
  brief: "brief",
  profile: "profile",
  user: "user",
};

/** Zero-based indexes of the brief facts `text` states (the offering's
 *  name is every frame's, never a point's own fact). */
export function factsIn(text: string, facts: readonly BriefFact[]): number[] {
  return facts.flatMap((f, n) =>
    f.kind !== "product" && factStated(f, text) ? [n] : [],
  );
}

/** The approved outline as the arc's pool: point k is frame k's, the
 *  action's point left out since the action frame takes no pool point. */
export function outlinePool(
  outline: ApprovedOutline,
  facts: readonly BriefFact[],
): ArcPoint[] {
  return outline.points.slice(0, -1).map((p) =>
    isEmptyPoint(p.point)
      ? { source: "brief" as const, text: "", facts: [] }
      : {
          source: POINT_SOURCE[p.source],
          text: p.point,
          facts: factsIn(p.point, facts),
        },
  );
}

/** The arc answer held to the approved order whatever the model
 *  assigned: frame k takes point k, the action none, the hook's claim is
 *  its point as the owner approved it, and nothing is spare. */
export function fixedArcAnswer<
  A extends Pick<ArcAnswer, "frames" | "hookAngle" | "spare" | "subjects">,
>(answer: A, outline: ApprovedOutline): A {
  const last = outline.points.length - 1;
  return {
    ...answer,
    hookAngle: outline.points[0]?.point ?? answer.hookAngle,
    spare: [],
    subjects: [],
    frames: outline.points.map((p, i) => ({
      ...(answer.frames[i] ?? {
        title: p.title,
        layout: "hero-center",
        showsImage: i === 0,
      }),
      point: i === last ? 0 : i + 1,
    })),
  };
}

/** What the owner wrote into the outline, which the ledger takes as
 *  stated (O4). */
export function ownerStatements(outline: ApprovedOutline | null): string[] {
  return (outline?.points ?? []).flatMap((p) =>
    p.source === "user" && !isEmptyPoint(p.point) ? [p.point] : [],
  );
}

/** By frame, the owner's own words, or "" where the point is not theirs. */
export function ownedClaims(outline: ApprovedOutline | null): string[] {
  return (outline?.points ?? []).map((p) =>
    p.source === "user" && !isEmptyPoint(p.point) ? p.point : "",
  );
}

/** By point, whether the owner wrote it: typed as their own ("user"), or
 *  changed from what the planner signed (`edited`). The last stand never
 *  swaps or drops such a frame. */
export function ownerWritten(outline: ApprovedOutline | null): boolean[] {
  return (outline?.points ?? []).map(
    (p) => !isEmptyPoint(p.point) && (p.source === "user" || p.edited === true),
  );
}

/** By point, the words the owner approved, or "" for an "Add a point"
 *  slide: what must still be said somewhere if its frame leaves. */
export function approvedPoints(outline: ApprovedOutline | null): string[] {
  return (outline?.points ?? []).map((p) =>
    isEmptyPoint(p.point) ? "" : p.point,
  );
}

/* Share of an owner's point's own words the frame must keep for its
   claim to stand: copy may shorten it, never swap it for another claim. */
const KEPT_SHARE = 0.5;

/**
 * Whether a frame's copy still makes the owner's point: every figure the
 * owner gave, and at least half of their own words, are on the frame
 * (O5: "a user-written point is not rewritten into a different claim").
 * Words every frame may share (`free`) are not counted either way.
 */
export function ownerPointKept(
  beat: Pick<FrameBeat, "headline" | "subheadline" | "footerLines" | "cta">,
  point: string,
  free: ReadonlySet<string> = new Set(),
): boolean {
  const copy = [beat.headline, beat.subheadline, beat.cta, ...beat.footerLines]
    .filter(Boolean)
    .join(" \n ");
  const said = numbersIn(copy);
  if ([...numbersIn(point)].some((n) => !said.has(n))) return false;
  const theirs = [...contentStems(point, free)];
  if (theirs.length === 0) return true;
  const mine = contentStems(copy, free);
  const kept = theirs.filter((s) => mine.has(s)).length;
  return kept / theirs.length >= KEPT_SHARE;
}

/** Whether a set still makes `point` on some frame or across them: its
 *  figures and at least half its own words are on the set (ownerPointKept
 *  read over every frame). */
export function pointKeptOnSet(
  frames: readonly Pick<
    FrameBeat,
    "headline" | "subheadline" | "footerLines" | "cta"
  >[],
  point: string,
  free: ReadonlySet<string> = new Set(),
): boolean {
  return ownerPointKept(
    {
      headline: frames.map((f) => f.headline).join(" \n "),
      subheadline: frames.map((f) => f.subheadline).join(" \n "),
      cta: frames.map((f) => f.cta).join(" \n "),
      footerLines: frames.flatMap((f) => f.footerLines),
    },
    point,
    free,
  );
}
