import type { FrameFix } from "@/lib/ai/prompts/design-sequence";
import type { ArcPoint } from "./arc";
import type { FrameBeat, PlannedSequence } from "./contract";
import {
  COVERAGE,
  type CopyFault,
  type FaultRules,
  faultScore,
  setFaults,
} from "./faults";
import type { FrameRewrite } from "./schema";
import { settledTitle } from "./title";

/**
 * How the fix call's answers are taken: its versions kept only where the
 * set improves, and a spare point for a frame whose point is another's.
 * Code chooses between the model's answers; it never writes one. What
 * still must not ship after the fix calls is settled in gate.ts.
 */

export const tidyLines = (lines: readonly string[]) =>
  lines.map((line) => line.trim()).filter(Boolean);

/** A frame with the model's rewrite in place of its words. Role, layout,
 *  image and scene are kept: the rewrite is of copy only. */
export function withRewrite(beat: FrameBeat, rewrite: FrameRewrite): FrameBeat {
  /* The action frame's button is the set's only one (H3): a rewrite that
     leaves it empty keeps the button it had. */
  const cta = beat.role === "cta" ? rewrite.cta.trim() || beat.cta : "";
  return {
    ...beat,
    title: settledTitle(rewrite.title, beat.title),
    headline: rewrite.headline.trim(),
    subheadline: rewrite.subheadline.trim(),
    cta,
    footerLines: tidyLines(rewrite.footerLines),
  };
}

/** The words a set of frames draws, for telling versions apart. */
export function copyKey(frames: readonly FrameBeat[]): string {
  return JSON.stringify(
    frames.map((f) => [
      f.title,
      f.headline,
      f.subheadline,
      f.cta,
      f.footerLines,
    ]),
  );
}

const coverageOf = (faults: readonly CopyFault[]) =>
  new Set(faults.filter((f) => f.weight >= COVERAGE).map((f) => f.detail));

/** Whether `after` ships with fewer faults than `before`, never by losing
 *  coverage: a brief fact or the offering is never the price of a fix,
 *  not even in trade for another one. */
export function improves(
  before: PlannedSequence,
  after: PlannedSequence,
  rules: FaultRules,
): boolean {
  const was = setFaults(before, rules);
  const now = setFaults(after, rules);
  const covered = coverageOf(was);
  return (
    [...coverageOf(now)].every((detail) => covered.has(detail)) &&
    faultScore(now) < faultScore(was)
  );
}

/**
 * The fix call's versions, kept frame by frame only where the set is left
 * with fewer faults (improves). Code chooses between the model's answers;
 * it never writes a word of any. Returns the frames whose rewrite was kept.
 */
export function applyFixes(
  plan: PlannedSequence,
  rewrites: readonly FrameRewrite[],
  asked: ReadonlySet<number>,
  rules: FaultRules,
  tidy: (frames: readonly FrameBeat[]) => FrameBeat[] = (f) => [...f],
): { plan: PlannedSequence; kept: number[] } {
  let current = plan;
  const kept: number[] = [];
  for (const index of [...asked].sort((a, b) => a - b)) {
    if (!current.frames[index]) continue;
    let best: PlannedSequence | null = null;
    for (const rewrite of rewrites.filter((r) => r.frame - 1 === index)) {
      const frames = tidy(
        current.frames.map((b, i) =>
          i === index ? withRewrite(b, rewrite) : b,
        ),
      );
      if (copyKey(frames) === copyKey(current.frames)) continue;
      const candidate = { ...current, frames };
      if (improves(best ?? current, candidate, rules)) best = candidate;
    }
    if (best) {
      current = best;
      kept.push(index);
    }
  }
  return { plan: current, kept };
}

/** The faults the fix call is asked about, by frame. */
export function fixesFor(faults: readonly CopyFault[]): FrameFix[] {
  const byFrame = new Map<number, string[]>();
  for (const fault of faults) {
    const list = byFrame.get(fault.frame) ?? [];
    if (!list.includes(fault.detail)) list.push(fault.detail);
    byFrame.set(fault.frame, list);
  }
  return [...byFrame.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, list]) => ({ index, faults: list }));
}

/* A body frame whose headline makes another frame's point cannot be fixed
   by rewording it: its claim is the other frame's. */
const POINT_TAKEN =
  /makes frame \d+'s point|says what frame \d+|built on the words of frame \d+/;

/** Body frames whose point another frame already makes, each given the
 *  next spare point of the pool as a new claim. */
export function newClaims(
  plan: PlannedSequence,
  blocking: readonly CopyFault[],
  spare: readonly number[],
  pool: readonly ArcPoint[],
): Map<number, string> {
  const claims = new Map<number, string>();
  const left = [...spare];
  for (const fault of blocking) {
    const beat = plan.frames[fault.frame];
    if (beat?.role !== "body" || claims.has(fault.frame)) continue;
    if (!POINT_TAKEN.test(fault.detail)) continue;
    const next = left.shift();
    if (next === undefined) break;
    claims.set(fault.frame, pool[next].text);
  }
  return claims;
}
