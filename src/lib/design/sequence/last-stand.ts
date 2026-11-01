import type { FrameBeat, PlannedSequence } from "./contract";
import { FRAME_BOUNDS } from "./contract";
import {
  blockingFaults,
  type CopyFault,
  type FaultRules,
  type Flag,
  faultScore,
  setFaults,
} from "./faults";
import { asSentence, fitsSubheadline } from "./gate";
import { namesFree } from "./hook";
import { framesToTry, plainVersions } from "./last-resort";
import { isStatFigure, settleFrameLayouts, withFigureLayout } from "./layouts";

/**
 * What runs when the last resort and the fix call leave a blocking fault
 * (rubric Addendum C, C1): code changes what a frame says rather than how.
 *
 *  1. Swap: a frame at fault is given a sourced point no frame makes (a
 *     spare from the pool: the brief's or the profile's own words), and is
 *     written from it in code (plainVersions). Never a frame the owner
 *     wrote: the owner's point is theirs to change.
 *  2. Drop: a middle frame at fault is taken off the set while the count
 *     stays within FRAME_BOUNDS. Its facts go to the action frame, the
 *     neighbours' layouts are settled again, and the drop is reported.
 *
 * Each change is kept only where the set ends with fewer blocking faults,
 * so a swap or a drop never trades one fault for another. What is left
 * after it is what the caller refuses.
 */

export interface StandInput {
  plan: PlannedSequence;
  rules: FaultRules;
  /** By frame, the claim each frame was written from. */
  claims: readonly string[];
  /** Sourced points no frame makes, best first. */
  spares: readonly string[];
  /** The brief's, the profile's and the owner's words, whose sentences a
   *  swapped frame may set under its point (plainVersions). */
  sourceText?: string;
  /** Settles titles and casing after a change; `kept` maps each frame to
   *  its index in the plan as first written. */
  tidy?: (frames: readonly FrameBeat[], kept: readonly number[]) => FrameBeat[];
  /** Writes facts no frame states onto their frame (withFactsDrawn), with
   *  the fact homes after a drop. */
  draw?: (
    plan: PlannedSequence,
    rules: FaultRules,
    kept: readonly number[],
  ) => PlannedSequence;
}

export interface StandResult {
  plan: PlannedSequence;
  rules: FaultRules;
  claims: string[];
  /** By frame, its index in the plan as first written. */
  kept: number[];
  /** Original indexes of the frames dropped, in order. */
  dropped: number[];
  /** "frame k: what changed", in order. */
  applied: string[];
  blocking: CopyFault[];
}

/* A set rarely needs more than a couple of swaps; bounded so a stand
   always ends. */
const MAX_CHANGES = 6;

const blockingScore = (plan: PlannedSequence, rules: FaultRules) =>
  faultScore(blockingFaults(setFaults(plan, rules)));

/** The flags of the audit with frame `gone` taken out and later frames
 *  moved up one. */
function flagsWithout(flags: readonly Flag[], gone: number): Flag[] {
  const moved = (i: number) => (i > gone ? i - 1 : i);
  return flags.flatMap((flag): Flag[] => {
    if (flag.frame === gone) return [];
    if (flag.kind === "repeat") {
      if (flag.sameAs === gone) return [];
      return [
        { ...flag, frame: moved(flag.frame), sameAs: moved(flag.sameAs) },
      ];
    }
    return [{ ...flag, frame: moved(flag.frame) }];
  });
}

/** `rules` for the set with frame `gone` taken off: its facts are the
 *  action frame's to carry, every other per-frame rule moves up one. */
export function rulesWithout(
  rules: FaultRules,
  gone: number,
  into?: number,
): FaultRules {
  const drop = <T>(list: readonly T[] | undefined) =>
    list ? list.filter((_, i) => i !== gone) : undefined;
  const owners = rules.owners
    ? (() => {
        const kept = rules.owners
          .filter((_, i) => i !== gone)
          .map((owned) => [...owned]);
        const home = into ?? kept.length - 1;
        if (kept[home]) {
          kept[home] = [...kept[home], ...(rules.owners[gone] ?? [])];
        }
        return kept;
      })()
    : undefined;
  /* A frame whose line moves into another (`into`) takes its claim and
     the owner's point with it. */
  const moved = <T>(list: readonly T[] | undefined, empty: T) =>
    list && into !== undefined
      ? list.map((v, i) => (i === into ? (list[gone] ?? empty) || v : v))
      : list;
  return {
    ...rules,
    frameCount: rules.frameCount - 1,
    owners,
    claims: drop(moved(rules.claims, "")),
    owned: drop(moved(rules.owned, "")),
    flagged: rules.flagged ? flagsWithout(rules.flagged, gone) : undefined,
    held: rules.held?.map((h) => ({
      text: h.text,
      frames: h.frames
        .filter((f) => f !== gone)
        .map((f) => (f > gone ? f - 1 : f)),
    })),
  };
}

/** The frames with neighbours' layouts settled again after a drop. */
function relaid(frames: readonly FrameBeat[], hasImage: boolean): FrameBeat[] {
  const layouts = settleFrameLayouts(
    frames.map((f) => ({
      layout: f.layout,
      showsImage: f.showsImage,
      figure: isStatFigure(f.headline),
    })),
    [],
    { panel: !hasImage },
  );
  return frames.map((f, i) => withFigureLayout({ ...f, layout: layouts[i] }));
}

export function lastStand({
  plan,
  rules,
  claims,
  spares,
  sourceText = "",
  tidy = (frames) => [...frames],
  draw = (p) => p,
}: StandInput): StandResult {
  let current = plan;
  let currentRules = rules;
  let currentClaims = [...claims];
  let kept = plan.frames.map((_, i) => i);
  const unused = [...spares];
  const dropped: number[] = [];
  const applied: string[] = [];
  let score = blockingScore(current, currentRules);
  const min = FRAME_BOUNDS[plan.kind].min;
  const free = namesFree(rules.brandName, rules.offering);
  const owned = (i: number) => (currentRules.owned?.[i] ?? "").trim() !== "";

  for (let change = 0; change < MAX_CHANGES && score > 0; change += 1) {
    const faults = blockingFaults(setFaults(current, currentRules));
    const frames = [
      ...new Set(faults.flatMap((f) => framesToTry(f, current.frames.length))),
    ];
    let best: {
      plan: PlannedSequence;
      rules: FaultRules;
      claims: string[];
      kept: number[];
      score: number;
      what: string;
      spare?: string;
      dropped?: number;
    } | null = null;

    for (const frame of frames) {
      const beat = current.frames[frame];
      if (!beat || beat.role === "cta" || owned(frame)) continue;
      for (const spare of unused) {
        const nextClaims = currentClaims.map((c, i) =>
          i === frame ? spare : c,
        );
        const nextRules: FaultRules = { ...currentRules, claims: nextClaims };
        /* The frame's old title and headline were written for the point
           it gave up: versions that rewrite the headline are tried first,
           so a tie goes to the frame that reads as its new point. */
        const versions = plainVersions(beat, spare, current.kind, sourceText, {
          others: current.frames
            .filter((_, i) => i !== frame)
            .map((b) => `${b.headline} ${b.subheadline}`),
          free,
        })
          .filter((v) => v.what !== "its title over its point")
          .sort(
            (a, b) =>
              Number(b.change.headline !== undefined) -
              Number(a.change.headline !== undefined),
          );
        for (const { change: copy, what } of versions) {
          const next: PlannedSequence = {
            ...current,
            frames: tidy(
              current.frames.map((b, i) =>
                i === frame ? { ...b, ...copy, title: b.title } : b,
              ),
              kept,
            ),
          };
          const nextScore = blockingScore(next, nextRules);
          if (nextScore < (best?.score ?? score)) {
            best = {
              plan: next,
              rules: nextRules,
              claims: nextClaims,
              kept,
              score: nextScore,
              what: `frame ${kept[frame] + 1}: given the spare point "${spare}", ${what}`,
              spare,
            };
          }
        }
      }
    }

    if (!best) {
      for (const frame of frames) {
        const beat = current.frames[frame];
        if (beat?.role !== "body" || current.frames.length <= min) {
          continue;
        }
        const nextKept = kept.filter((_, i) => i !== frame);
        const nextRules = rulesWithout(currentRules, frame);
        const nextClaims = currentClaims.filter((_, i) => i !== frame);
        const without: PlannedSequence = {
          ...current,
          frames: relaid(
            tidy(
              current.frames.filter((_, i) => i !== frame),
              nextKept,
            ),
            rules.hasImage,
          ),
        };
        const next = draw(without, nextRules, nextKept);
        const nextScore = blockingScore(next, nextRules);
        if (nextScore < (best?.score ?? score)) {
          best = {
            plan: next,
            rules: nextRules,
            claims: nextClaims,
            kept: nextKept,
            score: nextScore,
            what: `frame ${kept[frame] + 1}: dropped`,
            dropped: kept[frame],
          };
        }
      }
    }

    /* A hook that still blocks with no spare to give it (an announcement,
       "Scotch bonnet pepper sauce is back") takes a later frame's line as
       its headline, over its own subheadline that names the offering, and
       that frame leaves the set: a body frame's concrete point ("Last batch
       sold out in 9 days") is what a hook is built on. */
    if (!best && faults.some((f) => f.frame === 0)) {
      const hook = current.frames[0];
      for (let frame = 1; frame < current.frames.length - 1; frame += 1) {
        const beat = current.frames[frame];
        if (!hook || beat?.role !== "body" || current.frames.length <= min) {
          continue;
        }
        const nextKept = kept.filter((_, i) => i !== frame);
        const nextRules = rulesWithout(currentRules, frame, 0);
        const nextClaims = currentClaims
          .map((c, i) => (i === 0 ? currentClaims[frame] || c : c))
          .filter((_, i) => i !== frame);
        /* Under it: the hook's own point said whole, which names the
           offering ("Ata Kitchen's scotch bonnet pepper sauce, made
           small-batch in Ibadan."), else either frame's own line. */
        const own = currentClaims[0]?.trim() ?? "";
        const unders = new Set(
          [
            ...(own ? [asSentence(own)] : []),
            ...plainVersions(hook, own, current.kind, sourceText, { free }).map(
              (v) => v.change.subheadline ?? "",
            ),
            hook.subheadline,
            beat.subheadline,
          ].filter((t) => t.trim() && fitsSubheadline(t)),
        );
        for (const subheadline of unders) {
          const promoted: FrameBeat = {
            ...hook,
            headline: beat.headline,
            subheadline,
          };
          const without: PlannedSequence = {
            ...current,
            frames: relaid(
              tidy(
                current.frames
                  .map((b, i) => (i === 0 ? promoted : b))
                  .filter((_, i) => i !== frame),
                nextKept,
              ),
              rules.hasImage,
            ),
          };
          const next = draw(without, nextRules, nextKept);
          const nextScore = blockingScore(next, nextRules);
          if (nextScore < (best?.score ?? score)) {
            best = {
              plan: next,
              rules: nextRules,
              claims: nextClaims,
              kept: nextKept,
              score: nextScore,
              what: `frame ${kept[frame] + 1}: its line made the hook's headline, and the frame dropped`,
              dropped: kept[frame],
            };
          }
        }
      }
    }

    if (!best) break;
    current = best.plan;
    currentRules = best.rules;
    currentClaims = best.claims;
    kept = best.kept;
    score = best.score;
    applied.push(best.what);
    if (best.spare !== undefined) {
      unused.splice(unused.indexOf(best.spare), 1);
    }
    if (best.dropped !== undefined) dropped.push(best.dropped);
  }

  return {
    plan: current,
    rules: currentRules,
    claims: currentClaims,
    kept,
    dropped,
    applied,
    blocking: blockingFaults(setFaults(current, currentRules)),
  };
}
