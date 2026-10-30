import type { FrameBeat, PlannedSequence } from "./contract";

/**
 * The last step before a set ships: a line code found at fault (a point the
 * hook spends early, a phrase two frames share, a commercial term no source
 * gives) is cut when the set reads better without it. Round 5 detected 45
 * such faults across 23 of 30 runs and shipped every one the single edit
 * pass did not fix. Code only removes words, never writes one: a sentence of
 * a subheadline, a footer line, or a whole subheadline that carries an
 * invented term. A headline and the
 * action frame's button are never cut, since a frame cannot be drawn
 * without them.
 */

export interface Cut {
  frame: number;
  removed: string;
}

const SENTENCE_BREAK = /(?<=[.!?])\s+(?=\S)/;

/** Each way one frame can lose one line, as the frame it leaves. The
 *  whole subheadline only when `whole` allows it: a frame left with its
 *  headline alone reads as a fragment (round 6's first run cut eleven
 *  subheadlines for sharing a word, and the judge marked each frame thin). */
export function cutsOf(
  beat: FrameBeat,
  whole = false,
): { beat: FrameBeat; removed: string }[] {
  const out: { beat: FrameBeat; removed: string }[] = [];
  const subheadline = beat.subheadline.trim();
  if (subheadline) {
    const sentences = subheadline.split(SENTENCE_BREAK);
    if (sentences.length > 1) {
      sentences.forEach((sentence, i) => {
        out.push({
          beat: {
            ...beat,
            subheadline: sentences.filter((_, j) => j !== i).join(" "),
          },
          removed: sentence,
        });
      });
    }
    if (whole) {
      out.push({ beat: { ...beat, subheadline: "" }, removed: subheadline });
    }
  }
  beat.footerLines.forEach((line, i) => {
    out.push({
      beat: {
        ...beat,
        footerLines: beat.footerLines.filter((_, j) => j !== i),
      },
      removed: line,
    });
  });
  return out;
}

/**
 * The plan with lines cut, one at a time, while a cut lowers `measure` (the
 * planner's planScore: rules, invented words and copy faults, weighted) and
 * `holds` (no fact or rule lost) allows it. Each round takes the cut that
 * lowers it most, so a line at fault on two counts goes before one at
 * fault on one.
 */
export function withFaultsCut(
  plan: PlannedSequence,
  measure: (plan: PlannedSequence) => number,
  holds: (before: PlannedSequence, after: PlannedSequence) => boolean,
  /** Whether a frame's whole subheadline may go: the planner allows it
   *  only for one carrying words no source gives. */
  wholeSubheadline: (beat: FrameBeat) => boolean = () => false,
  /** Whether these words may go at all. */
  cuttable: (removed: string) => boolean = () => true,
): { plan: PlannedSequence; cuts: Cut[] } {
  let current = plan;
  let currentScore = measure(plan);
  const cuts: Cut[] = [];
  for (;;) {
    let best: { plan: PlannedSequence; score: number; cut: Cut } | null = null;
    current.frames.forEach((beat, frame) => {
      for (const option of cutsOf(beat, wholeSubheadline(beat))) {
        if (!cuttable(option.removed)) continue;
        const candidate = {
          ...current,
          frames: current.frames.map((b, i) => (i === frame ? option.beat : b)),
        };
        if (!holds(current, candidate)) continue;
        const score = measure(candidate);
        if (score < (best?.score ?? currentScore)) {
          best = {
            plan: candidate,
            score,
            cut: { frame, removed: option.removed },
          };
        }
      }
    });
    if (!best) break;
    const chosen: { plan: PlannedSequence; score: number; cut: Cut } = best;
    current = chosen.plan;
    currentScore = chosen.score;
    cuts.push(chosen.cut);
  }
  return { plan: current, cuts };
}
