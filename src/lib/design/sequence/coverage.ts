import { type BriefFact, factStated } from "@/lib/jobs/directions/brief-facts";
import { COPY_LIMITS, DRAFT_LIMITS } from "@/lib/jobs/directions/schema";
import type { FrameBeat, PlannedSequence, SequenceKind } from "./contract";
import { copyLimitProblems, factsUncovered, frameCopy } from "./validate";

/* The offering is the hook's to name in its own sentence (offering-unnamed),
   never a footer line: a name in small print under a headline about
   something else does not say what is on offer. */
const NOT_A_FOOTER_LINE = new Set<BriefFact["kind"]>(["product"]);

/** The frames a missing fact may be written onto, best first: the frame
 *  the outline gave it, then the action frame (where how and when to act
 *  is read), then the middle frames in order. Never the hook, whose job is
 *  the reason to swipe. */
function homesFor(owner: number, frames: readonly FrameBeat[]): number[] {
  const last = frames.length - 1;
  const bodies = frames.flatMap((beat, i) => (beat.role === "body" ? [i] : []));
  const order = owner > 0 ? [owner, last, ...bodies] : [last, ...bodies];
  return [...new Set(order)].filter((i) => i > 0 && i <= last);
}

/** Whether the line leaves the frame drawable: within the footer's lines
 *  and adding no limit the frame did not already break. */
function fits(
  before: FrameBeat,
  after: FrameBeat,
  frame: number,
  kind: SequenceKind,
): boolean {
  const broken = (beat: FrameBeat) =>
    copyLimitProblems(beat, frame, kind, { budget: false }).length;
  return (
    after.footerLines.length <= DRAFT_LIMITS.footerLines &&
    broken(after) <= broken(before)
  );
}

/**
 * The plan with every brief fact the copy still leaves out written as a
 * footer line, in the brief's own words, on the frame that was meant to
 * carry it. The last resort after the edit pass: round 4's critic watched
 * the planner report `fact-uncovered: no frame states "5pm to 9pm"` and
 * ship the set without the evening hours (H5). The words are the brief's,
 * as the directions path draws a fact a direction left out, so code adds
 * no claim; a line is kept only where it fits the footer and is read as
 * stating the fact.
 *
 * `owners` holds each fact's planned frame by fact index (the outline's
 * factsByFrame); a fact with none goes to the action frame.
 */
export function withFactsDrawn(
  plan: PlannedSequence,
  facts: readonly BriefFact[],
  owners: readonly number[][],
): { plan: PlannedSequence; drawn: string[] } {
  let frames = plan.frames;
  const drawn: string[] = [];
  for (const fact of factsUncovered(frames, facts)) {
    const line = fact.text.trim();
    if (NOT_A_FOOTER_LINE.has(fact.kind) || !line) continue;
    if (line.length > COPY_LIMITS.footerLine) continue;
    const index = facts.indexOf(fact);
    const owner = owners.findIndex((owned) => owned.includes(index));
    for (const home of homesFor(owner, frames)) {
      const beat = frames[home];
      const next = { ...beat, footerLines: [...beat.footerLines, line] };
      if (!fits(beat, next, home, plan.kind)) continue;
      if (!factStated(fact, frameCopy(next))) continue;
      frames = frames.map((b, i) => (i === home ? next : b));
      drawn.push(line);
      break;
    }
  }
  return { plan: drawn.length > 0 ? { ...plan, frames } : plan, drawn };
}
