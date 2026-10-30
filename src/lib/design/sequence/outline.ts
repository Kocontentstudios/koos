import type { DesignSpec } from "@/lib/design/spec";
import type { CoverKind } from "@/lib/jobs/directions/brief-facts";
import { isNearDuplicateHeadline } from "@/lib/jobs/directions/text-overlap";
import type { FrameRole } from "./contract";
import { hasFigure, settleFrameLayouts } from "./layouts";
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
  /** Zero-based index into the brand profile's points (profilePoints),
   *  or null when the frame's point is the brief's. */
  profilePoint: number | null;
  /** Zero-based index into the brief's own points (briefPoints), or null. */
  briefPoint: number | null;
  layout: DesignSpec["layout"];
  showsImage: boolean;
}

export interface OutlineSettlement {
  frames: SettledOutlineFrame[];
  /** Facts the model left on no frame, placed by code (homeFor). */
  factsPlaced: number[];
  layoutsChanged: number;
  /** Frames that cited a profile point an earlier frame already made:
   *  the citation is dropped and the frame's point counts as repeated. */
  profileReused: number[];
  /** Frames that cited a brief point an earlier frame was built on. */
  briefReused: number[];
  /** Middle frames built on no source (no fact, brief point or profile
   *  point) while one was left unused: a frame with nothing of its own to
   *  say restates a neighbour or pads (round-4 critic, LOW 8: "Exactly what
   *  you want at lunch."). Empty when every source is spent. */
  unsourced: number[];
}

type OutlineFrameIn = Omit<
  OutlineAnswer["frames"][number],
  "profilePoint" | "briefPoint"
> & {
  profilePoint?: number;
  briefPoint?: number;
};

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
 *  - with `priceWithAction` (a carousel), a price is the action frame's:
 *    it answers what acting costs, and a middle frame holding only the
 *    price read as "a receipt stub where a slide should be" (round-2
 *    critic, every five-frame carousel);
 *  - with `whereWhenOffHook` (a carousel of three frames or more), the
 *    hook carries no date, day, time, place or contact: round 3 and 4's
 *    cafe hook "Cold brew at our Yaba bar" was the name and where, which
 *    the judge scored 3 at every N and called "purely locational
 *    housekeeping", and it survived the edit pass because a version that
 *    dropped the venue lost the coverage the outline had put there;
 *  - a brand-profile point (a thin brief's second source) is a middle
 *    frame's, and made once: the hook and the action have the brief's
 *    jobs, and a second frame citing one point is that point twice;
 *  - with no image no frame shows one, and with one the hook does;
 *  - layouts are settled by settleFrameLayouts.
 */
export function settleOutline(
  answer: { frames: readonly OutlineFrameIn[] },
  {
    factCount,
    profilePointCount = 0,
    briefPointCount = 0,
    offeringFact,
    hasImage,
    recentLayouts = [],
    factKinds = [],
    factTexts = [],
    priceWithAction = false,
    whereWhenOffHook = false,
  }: {
    factCount: number;
    /** How many brand-profile points the outline was offered. */
    profilePointCount?: number;
    /** How many brief points (briefPoints) the outline was offered. */
    briefPointCount?: number;
    /** Each fact's kind, by index, so a fact left unplaced finds the
     *  frame whose point it belongs to. */
    factKinds?: readonly CoverKind[];
    /** Each fact's words, by index: a frame stating a figure may be set
     *  as stat-highlight, and no other. */
    factTexts?: readonly string[];
    /** Index of the offering's own fact, which the hook carries. */
    offeringFact: number | null;
    hasImage: boolean;
    recentLayouts?: readonly string[];
    /** Every price goes on the last frame, beside the action. */
    priceWithAction?: boolean;
    /** The hook states no logistics; they go where homeFor puts them. */
    whereWhenOffHook?: boolean;
  },
): OutlineSettlement {
  const count = answer.frames.length;
  const owned = new Set<number>(offeringFact === null ? [] : [offeringFact]);
  /* Each source makes one frame's point; a second frame citing it is that
     point twice, so the citation is dropped and the frame is named. A
     profile point is a middle frame's only; a brief point may be the
     hook's too. */
  const citer = (available: number, bodyOnly: boolean) => {
    const used = new Set<number>();
    const reused: number[] = [];
    const of = (cited: number | undefined, i: number): number | null => {
      const n = (cited ?? 0) - 1;
      if (!Number.isInteger(n) || n < 0 || n >= available) return null;
      if (bodyOnly && roleOf(i, count) !== "body") return null;
      if (used.has(n)) {
        reused.push(i);
        return null;
      }
      used.add(n);
      return n;
    };
    return { of, used, reused };
  };
  const profile = citer(profilePointCount, true);
  const brief = citer(briefPointCount, false);
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
      profilePoint: profile.of(frame.profilePoint, i),
      briefPoint: brief.of(frame.briefPoint, i),
      layout: frame.layout,
      showsImage: hasImage && (i === 0 || frame.showsImage),
    };
  });
  if (offeringFact !== null && frames[0]) frames[0].facts.unshift(offeringFact);
  const lastFrame = frames[count - 1];
  if (priceWithAction && lastFrame) {
    const isPrice = (n: number) =>
      factKinds[n] === "price" && n !== offeringFact;
    for (const frame of frames) {
      if (frame === lastFrame) continue;
      const prices = frame.facts.filter(isPrice);
      frame.facts = frame.facts.filter((n) => !isPrice(n));
      lastFrame.facts.push(...prices);
    }
  }
  const hook = frames[0];
  if (whereWhenOffHook && hook && count >= 3) {
    hook.facts = hook.facts.filter(
      (n) => n === offeringFact || !WHERE_WHEN.has(factKinds[n] as CoverKind),
    );
  }
  const placed = new Set(frames.flatMap((f) => f.facts));
  const factsPlaced: number[] = [];
  for (let n = 0; n < factCount; n += 1) {
    if (placed.has(n)) continue;
    factsPlaced.push(n);
    const home =
      priceWithAction && factKinds[n] === "price"
        ? count - 1
        : homeFor(frames, factKinds[n]);
    frames[home]?.facts.push(n);
  }
  const layouts = settleFrameLayouts(
    frames.map((frame) => ({
      ...frame,
      figure: frame.facts.some((n) => hasFigure(factTexts[n] ?? "")),
    })),
    recentLayouts,
  );
  let layoutsChanged = 0;
  frames.forEach((frame, i) => {
    if (frame.layout !== layouts[i]) layoutsChanged += 1;
    frame.layout = layouts[i];
  });
  const spare =
    profile.used.size < profilePointCount || brief.used.size < briefPointCount;
  const unsourced = spare
    ? frames.flatMap((frame, i) =>
        frame.role === "body" &&
        frame.facts.length === 0 &&
        frame.profilePoint === null &&
        frame.briefPoint === null
          ? [i]
          : [],
      )
    : [];
  return {
    frames,
    factsPlaced,
    layoutsChanged,
    profileReused: profile.reused,
    briefReused: brief.reused,
    unsourced,
  };
}

const WHERE_WHEN = new Set<CoverKind>([
  "date",
  "day",
  "time",
  "place",
  "contact",
]);

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
