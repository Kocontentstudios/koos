import type { DesignSpec } from "@/lib/design/spec";
import type { CoverKind } from "@/lib/jobs/directions/brief-facts";
import { isNearDuplicateHeadline } from "@/lib/jobs/directions/text-overlap";
import type { FrameRole } from "./contract";
import { settleFrameLayouts } from "./layouts";
import type { FrameBeatKind, OutlineAnswer } from "./schema";

/** A frame's role is its position: the hook opens, the call to action
 *  closes, everything between carries one point. */
export function roleOf(index: number, count: number): FrameRole {
  if (index === 0) return "hook";
  return index === count - 1 ? "cta" : "body";
}

export interface SettledOutlineFrame {
  role: FrameRole;
  title: string;
  point: string;
  beat: FrameBeatKind;
  /** Zero-based indexes into the brief's facts. */
  facts: number[];
  layout: DesignSpec["layout"];
  showsImage: boolean;
}

export interface OutlineSettlement {
  frames: SettledOutlineFrame[];
  /** Facts the model left on no frame, placed by code (homeFor). */
  factsPlaced: number[];
  layoutsChanged: number;
}

/**
 * The model's arc, held to the rules no copy is needed to check, before any
 * copy is written. Everything settled here is structure, not words:
 *  - roles come from position (hook first, cta last);
 *  - a fact the model numbered wrong is dropped, a fact it gave several
 *    frames stays with the first (a fact said twice is a frame with
 *    nothing new), and a fact it put on no frame is given one (homeFor),
 *    so set-level coverage (H5) is planned before it is written;
 *  - the offering is the hook's to name (offeringFact), and only the
 *    hook's to be held to;
 *  - with no image no frame shows one, and with one the hook does;
 *  - layouts are settled by settleFrameLayouts.
 */
export function settleOutline(
  answer: Pick<OutlineAnswer, "frames">,
  {
    factCount,
    offeringFact,
    hasImage,
    recentLayouts = [],
    factKinds = [],
  }: {
    factCount: number;
    /** Each fact's kind, by index, so a fact left unplaced finds the
     *  frame whose point it belongs to. */
    factKinds?: readonly CoverKind[];
    /** Index of the offering's own fact, which the hook carries. */
    offeringFact: number | null;
    hasImage: boolean;
    recentLayouts?: readonly string[];
  },
): OutlineSettlement {
  const count = answer.frames.length;
  const owned = new Set<number>(offeringFact === null ? [] : [offeringFact]);
  const frames = answer.frames.map((frame, i) => {
    const facts = frame.facts
      .map((n) => n - 1)
      .filter(
        (n) => Number.isInteger(n) && n >= 0 && n < factCount && !owned.has(n),
      );
    for (const n of facts) owned.add(n);
    return {
      role: roleOf(i, count),
      beat: frame.beat,
      title: frame.title.trim(),
      point: frame.point.trim(),
      facts,
      layout: frame.layout,
      showsImage: hasImage && (i === 0 || frame.showsImage),
    };
  });
  if (offeringFact !== null && frames[0]) frames[0].facts.unshift(offeringFact);
  const placed = new Set(frames.flatMap((f) => f.facts));
  const factsPlaced: number[] = [];
  for (let n = 0; n < factCount; n += 1) {
    if (placed.has(n)) continue;
    factsPlaced.push(n);
    frames[homeFor(frames, factKinds[n])]?.facts.push(n);
  }
  const layouts = settleFrameLayouts(frames, recentLayouts);
  let layoutsChanged = 0;
  frames.forEach((frame, i) => {
    if (frame.layout !== layouts[i]) layoutsChanged += 1;
    frame.layout = layouts[i];
  });
  return { frames, factsPlaced, layoutsChanged };
}

/* The beats a fact of each kind is the point of. */
const BEATS_FOR: Partial<Record<CoverKind, readonly FrameBeatKind[]>> = {
  price: ["price"],
  offer: ["price", "scarcity"],
  quantity: ["scarcity", "price"],
  condition: ["scarcity", "price"],
  date: ["when-where"],
  day: ["when-where"],
  time: ["when-where"],
  place: ["when-where"],
  age: ["audience"],
  person: ["proof", "detail"],
};

/**
 * Where a fact the model put on no frame goes: the body frame whose beat
 * it is the point of, else the first body frame that states nothing yet,
 * else the last frame. A contact is the action's, so it goes last. The
 * last frame is the fallback, not the default: round-1 critic, a sparse
 * outline left the textile set's action frame holding a headline, a button
 * and three footer lines while body frames stated nothing.
 */
export function homeFor(
  frames: readonly Pick<SettledOutlineFrame, "role" | "beat" | "facts">[],
  kind: CoverKind | undefined,
): number {
  const last = frames.length - 1;
  if (kind === undefined || kind === "contact") return last;
  const beats = BEATS_FOR[kind] ?? [];
  const bodies = frames
    .map((frame, i) => ({ frame, i }))
    .filter(({ frame }) => frame.role === "body");
  const byBeat = bodies.find(({ frame }) => beats.includes(frame.beat));
  if (byBeat) return byBeat.i;
  const empty = bodies.find(({ frame }) => frame.facts.length === 0);
  return empty ? empty.i : last;
}

/** Points of an outline that make the same point as an earlier frame, by
 *  the same overlap the headlines are held to. `ignore` holds the stems
 *  every frame may share: the brand's and the offering's names. */
export function repeatedPoints(
  frames: readonly { point: string; title: string; beat?: string }[],
  ignore: ReadonlySet<string> = new Set(),
): string[] {
  const repeated: string[] = [];
  frames.forEach((frame, j) => {
    const twin = frames
      .slice(0, j)
      .some(
        (earlier) =>
          (frame.beat !== undefined && earlier.beat === frame.beat) ||
          isNearDuplicateHeadline(earlier.title, frame.title, ignore) ||
          isNearDuplicateHeadline(earlier.point, frame.point, ignore),
      );
    if (twin) repeated.push(frame.point);
  });
  return repeated;
}
