import {
  aboveRepeats,
  type BriefFact,
  drawnText,
  dropFooterRepeats,
  factStated,
  headlineFooterRepeats,
  numbersIn,
  redundantFooterItems,
  withoutRepeatingSubheadline,
} from "@/lib/jobs/directions/brief-facts";
import { isNearDuplicateHeadline } from "@/lib/jobs/directions/text-overlap";
import type { FrameBeat } from "./contract";
import { frameCopy } from "./validate";

/**
 * Copy a set says twice: inside one frame (a subheadline restating its
 * headline, a footer item restating the copy above), or across frames (a
 * fact given again on a later frame, a subheadline another frame already
 * used as its line). The first eval round's judge read exactly this as
 * "one message cut into pieces" (nonRepetitive 2.25 of 5).
 *
 * Not a contract rule: a repeat is drawable, so the job never fails a set
 * for one. The planner asks the repair pass to take them out, keeps a
 * rewrite only when it leaves fewer, and drops a repeating subheadline in
 * code when nothing is lost (withoutRepeatingSubheadline).
 */

export interface FrameRepeat {
  frame: number;
  detail: string;
}

function withinFrame(beat: FrameBeat, index: number, offering: string) {
  const copy = frameCopy(beat);
  return [
    ...aboveRepeats(copy),
    ...headlineFooterRepeats(copy).map(
      (item) => `the footer item "${item}" gives the headline's value again`,
    ),
    ...redundantFooterItems(copy, offering).map(
      (item) => `the footer item "${item}" says what the copy above says`,
    ),
  ].map((detail) => ({ frame: index, detail }));
}

/* The offering is named on the hook and may be named again where a point
   needs it; every other fact is said once. */
function factRepeats(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
): FrameRepeat[] {
  const out: FrameRepeat[] = [];
  for (const fact of facts) {
    if (fact.kind === "product") continue;
    const stating = frames
      .map((beat, i) => (factStated(fact, frameCopy(beat)) ? i : -1))
      .filter((i) => i >= 0);
    for (const later of stating.slice(1)) {
      out.push({
        frame: later,
        detail: `it gives "${fact.text}" again, which frame ${stating[0] + 1} already states`,
      });
    }
  }
  return out;
}

/* A frame's lines against every earlier frame's: a line another frame
   already used, in other words. Two headlines alike are validateSequence's
   headline-repeat, a contract rule, so only the other pairings count here. */
function lineRepeats(frames: readonly FrameBeat[]): FrameRepeat[] {
  const out: FrameRepeat[] = [];
  const linesOf = (beat: FrameBeat) =>
    [
      { line: beat.headline, headline: true },
      { line: beat.subheadline, headline: false },
    ].filter((l) => l.line.trim());
  frames.forEach((beat, j) => {
    for (let i = 0; i < j; i += 1) {
      const echo = linesOf(beat).find((mine) =>
        linesOf(frames[i]).some(
          (said) =>
            !(mine.headline && said.headline) &&
            isNearDuplicateHeadline(said.line, mine.line),
        ),
      );
      if (echo) {
        out.push({
          frame: j,
          detail: `"${echo.line}" says what frame ${i + 1} already says`,
        });
        return;
      }
    }
  });
  return out;
}

/* "One" and "two" are words more than counts ("for two", "one bottle"). */
const PLAIN_WORDS = new Set(["1", "2"]);

/* A number given on two frames is one point made twice even when no fact
   of the brief names it: round 2's cafe set opened on "18 hours in the
   making" and followed with "18 hours. Not a minute less." */
function numberRepeats(
  frames: readonly FrameBeat[],
  offering: string,
): FrameRepeat[] {
  const named = numbersIn(offering);
  const seen = new Map<string, number>();
  const out: FrameRepeat[] = [];
  frames.forEach((beat, j) => {
    const numbers = [...numbersIn(drawnText(frameCopy(beat)))].filter(
      (n) => !PLAIN_WORDS.has(n) && !named.has(n),
    );
    const again = numbers.find((n) => seen.has(n));
    if (again !== undefined) {
      out.push({
        frame: j,
        detail: `it gives ${again} again, which frame ${(seen.get(again) ?? 0) + 1} already gives`,
      });
    }
    for (const n of numbers) if (!seen.has(n)) seen.set(n, j);
  });
  return out;
}

export function sequenceRepeats(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  offering: string | null,
): FrameRepeat[] {
  const byFact = factRepeats(frames, facts);
  const factFrames = new Set(byFact.map((r) => r.frame));
  return [
    ...frames.flatMap((beat, i) => withinFrame(beat, i, offering ?? "")),
    ...byFact,
    ...numberRepeats(frames, offering ?? "").filter(
      (r) => !factFrames.has(r.frame),
    ),
    ...lineRepeats(frames),
  ];
}

/**
 * Each frame without what it says twice, where dropping it loses no fact
 * the frame states: a subheadline that only restates its headline, and
 * footer items the copy above or another item already carries (the
 * directions' own drops, withoutRepeatingSubheadline and
 * dropFooterRepeats). Code drops; it never rewrites.
 */
export function withoutRepeats(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  offering: string | null,
): FrameBeat[] {
  const copies = frames.map((beat) =>
    withoutRepeatingSubheadline(
      { ...frameCopy(beat), footerStyle: "text" as const },
      facts,
    ),
  );
  const { directions } = dropFooterRepeats(copies, facts, offering ?? "");
  return frames.map((beat, i) => ({
    ...beat,
    subheadline: directions[i].subheadline ?? "",
    footerLines: directions[i].footerLines,
  }));
}
