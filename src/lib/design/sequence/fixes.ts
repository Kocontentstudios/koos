import type { FrameFix } from "@/lib/ai/prompts/design-sequence";
import { formatRules } from "@/lib/design/formats";
import { COPY_LIMITS } from "@/lib/jobs/directions/schema";
import type { ArcFrame, ArcPoint } from "./arc";
import type { FrameBeat, PlannedSequence, SequenceKind } from "./contract";
import { withoutStatement } from "./cuts";
import {
  blockingFaults,
  COVERAGE,
  type CopyFault,
  type FaultRules,
  faultScore,
  setFaults,
  stillSays,
} from "./faults";
import { textStatesPrice } from "./points";
import { withoutFactWords } from "./repeats";
import type { FrameRewrite } from "./schema";
import { settledTitle } from "./title";

/**
 * How a written set's faults are settled: the fix call's versions kept
 * only where the set improves, a spare point for a frame whose point is
 * another's, and what still blocks cut in code. Code chooses between the
 * model's answers and removes words; it never writes one.
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
  faults.filter((f) => f.weight >= COVERAGE).length;

/** Whether `after` ships with fewer faults than `before`, never by losing
 *  coverage: a brief fact or the offering is never the price of a fix. */
export function improves(
  before: PlannedSequence,
  after: PlannedSequence,
  rules: FaultRules,
): boolean {
  const was = setFaults(before, rules);
  const now = setFaults(after, rules);
  return (
    coverageOf(now) <= coverageOf(was) && faultScore(now) < faultScore(was)
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

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Whether `text` can stand as a headline of `kind` as written. */
function fitsHeadline(text: string, kind: SequenceKind): boolean {
  return (
    text.length > 0 &&
    text.length <= COPY_LIMITS.headline &&
    wordCount(text) <= formatRules(kind).headlineWords + 2
  );
}

/* A fault whose words are a statement no source gives: inventedOn's and
   the audit's. */
export const UNSOURCED = /^it states "(.+)", which neither/;
const ABOUT_ITSELF = /talks about the set itself \("(.+)"\)/;

/**
 * The faults that must not ship and that no rewrite fixed, settled in
 * code by removing words or putting a sourced claim in their place, each
 * kept only where the set improves (improves):
 *  - a carousel's price in a headline: the price's words cut where the
 *    rest reads on its own, else the frame's claim as headline;
 *  - a headline making another frame's point: the frame's own claim, in
 *    its source's words;
 *  - a statement no source gives, or copy about the set itself: its words
 *    or its sentence cut (withoutStatement), else a headline set to the
 *    frame's claim;
 *  - a subheadline that is not a sentence: left out.
 */
export function withLastResorts(
  plan: PlannedSequence,
  arc: readonly ArcFrame[],
  rules: FaultRules,
): { plan: PlannedSequence; applied: string[] } {
  let current = plan;
  const applied: string[] = [];
  const attempt = (frame: number, change: Partial<FrameBeat>, what: string) => {
    const candidate = {
      ...current,
      frames: current.frames.map((b, i) =>
        i === frame ? { ...b, ...change } : b,
      ),
    };
    if (!improves(current, candidate, rules)) return false;
    current = candidate;
    applied.push(`frame ${frame + 1}: ${what}`);
    return true;
  };
  const toClaim = (frame: number, claim: string) =>
    fitsHeadline(claim, current.kind) &&
    attempt(frame, { headline: claim }, "headline set to its claim");
  for (const fault of blockingFaults(setFaults(current, rules))) {
    const beat = current.frames[fault.frame];
    if (!beat) continue;
    const claim = arc[fault.frame]?.claim ?? "";
    const statement =
      UNSOURCED.exec(fault.detail)?.[1] ?? ABOUT_ITSELF.exec(fault.detail)?.[1];
    if (statement) {
      const cut = withoutStatement(beat, statement);
      if (cut && attempt(fault.frame, cut, `cut "${statement}"`)) continue;
      if (stillSays({ ...beat, subheadline: "", footerLines: [] }, statement)) {
        toClaim(fault.frame, claim);
      }
    } else if (
      fault.field === "headline" &&
      /gives the price/.test(fault.detail)
    ) {
      const price = rules.facts.find(
        (f) => f.kind === "price" && fault.detail.includes(`"${f.text}"`),
      );
      const cut = price ? withoutFactWords(beat.headline, price) : null;
      if (cut && attempt(fault.frame, { headline: cut }, "price cut")) continue;
      const priced = price !== undefined && textStatesPrice(price, claim);
      if (!priced) toClaim(fault.frame, claim);
    } else if (fault.field === "headline" && POINT_TAKEN.test(fault.detail)) {
      toClaim(fault.frame, claim);
    } else if (fault.field === "subheadline" && beat.subheadline) {
      attempt(fault.frame, { subheadline: "" }, "subheadline left out");
    }
  }
  return { plan: current, applied };
}
