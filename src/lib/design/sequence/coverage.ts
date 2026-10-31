import {
  type BriefFact,
  factStated,
  numbersIn,
} from "@/lib/jobs/directions/brief-facts";
import { COPY_LIMITS, DRAFT_LIMITS } from "@/lib/jobs/directions/schema";
import type { FrameBeat, PlannedSequence, SequenceKind } from "./contract";
import { copyLimitProblems, factsUncovered, frameCopy } from "./validate";

/* The offering is the hook's to name in its own sentence (offering-unnamed),
   never a footer line: a name in small print under a headline about
   something else does not say what is on offer. */
const NOT_A_FOOTER_LINE = new Set<BriefFact["kind"]>(["product"]);

const RESTATABLE = new Set<BriefFact["kind"]>([
  "quantity",
  "offer",
  "condition",
  "age",
]);

/** The frames a missing fact may be written onto, best first: the frame
 *  the arc gave it, then the action frame (where how and when to act
 *  is read), then the middle frames in order; a figure that is a reason
 *  tries the middle frames before the action. Never the hook, whose job
 *  is the reason to swipe. */
function homesFor(
  owner: number,
  frames: readonly FrameBeat[],
  fact: BriefFact,
): number[] {
  const last = frames.length - 1;
  const bodies = frames.flatMap((beat, i) => (beat.role === "body" ? [i] : []));
  /* A figure that is a reason (a tonnage, a margin) belongs to the middle
     of the set: on the action frame three of them read as a stat dump
     under the ask. */
  const rest = AT_ACTION.has(fact.kind) ? [last, ...bodies] : [...bodies, last];
  /* A frame whose footer already gives part of the fact ("60-minute
     session" for "One 60-minute session") takes the whole in its place. */
  const partly = frames.flatMap((beat, i) =>
    givesPart(beat, fact.text) ? [i] : [],
  );
  const order = owner > 0 ? [owner, ...partly, ...rest] : [...partly, ...rest];
  return [...new Set(order)].filter((i) => i > 0 && i <= last);
}

const givesPart = (beat: FrameBeat, text: string) =>
  beat.footerLines.some((line) =>
    line.split(ITEM_BREAK).some((item) => {
      const part = item.trim().toLowerCase();
      return part.length > 0 && text.toLowerCase().includes(part);
    }),
  );

/* What the reader acts on: read beside the button. */
const AT_ACTION = new Set<BriefFact["kind"]>([
  "contact",
  "price",
  "date",
  "day",
  "time",
  "place",
  "offer",
  "condition",
]);

/* A count whose figures the frame's own headline or subheadline already
   gives would be on the frame twice ("5,000 more kits" under "The round
   buys 5,000 more kits"), however the verifier reads the words around it.
   A price, date, time or contact is still drawn whole: the reader acts on
   its exact words. */
function givesFigures(beat: FrameBeat, fact: BriefFact): boolean {
  if (!RESTATABLE.has(fact.kind)) return false;
  const figures = [...numbersIn(fact.text)];
  if (figures.length === 0) return false;
  const said = numbersIn(`${beat.headline} ${beat.subheadline}`);
  return figures.every((n) => said.has(n));
}

const ITEM_BREAK = /\s+·\s+/;

/** `lines` with the fact's own words in place of a footer item that gives
 *  only part of them ("60-minute session" for "One 60-minute session"),
 *  else with them added as a line of their own. Beside its part, the
 *  whole reads as a second value and is not counted as stated. */
function withLine(lines: readonly string[], line: string): string[] {
  const whole = line.toLowerCase();
  let replaced = false;
  const next = lines.map((existing) =>
    existing
      .split(ITEM_BREAK)
      .map((item) => {
        const part = item.trim().toLowerCase();
        if (replaced || part.length === 0 || !whole.includes(part)) {
          return item;
        }
        replaced = true;
        return line;
      })
      .join(" · "),
  );
  return replaced ? next : [...lines, line];
}

/** `lines` with `line` joined onto one of them, shortest first, for a
 *  footer with no room for a line of its own. */
function merged(lines: readonly string[], line: string): string[][] {
  return lines
    .map((existing, i) => ({ existing, i }))
    .sort((a, b) => a.existing.length - b.existing.length)
    .map(({ existing, i }) =>
      lines.map((l, k) => (k === i ? `${existing} · ${line}` : l)),
    )
    .filter((joined) =>
      joined.every((l) => l.length <= COPY_LIMITS.footerLine),
    );
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
 * carry it. The last resort after the fix calls, so a set never ships
 * reporting `fact-uncovered` while leaving the fact off (H5). The words are the brief's,
 * as the directions path draws a fact a direction left out, so code adds
 * no claim; a line is kept only where it fits the footer and is read as
 * stating the fact.
 *
 * `owners` holds each fact's planned frame by fact index (the arc's
 * factsByFrame); a fact with none goes to the action frame. A fact the
 * owner took out of the approved outline (`released`, releasedFacts) is
 * never drawn: the owner's outline outranks coverage (O5 over H5); nor is
 * a line onto a frame where `refused` holds it (a line making a point the
 * owner removed).
 */
export function withFactsDrawn(
  plan: PlannedSequence,
  facts: readonly BriefFact[],
  owners: readonly number[][],
  released: readonly string[] = [],
  refused: (line: string, frame: number, fact: BriefFact) => boolean = () =>
    false,
): { plan: PlannedSequence; drawn: string[]; restated: string[] } {
  let frames = plan.frames;
  const drawn: string[] = [];
  const restated: string[] = [];
  const draw = (
    fact: BriefFact,
    strict: boolean,
    joining: boolean,
  ): boolean => {
    const line = fact.text.trim();
    const index = facts.indexOf(fact);
    const owner = owners.findIndex((owned) => owned.includes(index));
    for (const home of homesFor(owner, frames, fact)) {
      if (refused(line, home, fact)) continue;
      const beat = frames[home];
      if (strict && givesFigures(beat, fact)) continue;
      const footers = joining
        ? merged(beat.footerLines, line)
        : [withLine(beat.footerLines, line)];
      const next = footers
        .map((footerLines) => ({ ...beat, footerLines }))
        .find(
          (candidate) =>
            fits(beat, candidate, home, plan.kind) &&
            factStated(fact, frameCopy(candidate)),
        );
      if (!next) continue;
      frames = frames.map((b, i) => (i === home ? next : b));
      drawn.push(line);
      return true;
    }
    return false;
  };
  for (const fact of factsUncovered(frames, facts, released)) {
    const line = fact.text.trim();
    if (NOT_A_FOOTER_LINE.has(fact.kind) || !line) continue;
    if (line.length > COPY_LIMITS.footerLine) continue;
    /* Coverage is a hard gate (H5): a figure only a frame already giving
       it could take is drawn there too rather than shipped uncovered. */
    /* A line of its own is read before one joined onto another, and a
       full footer still takes the fact joined on rather than lose it. */
    const tries: [boolean, boolean][] = [
      [true, false],
      [false, false],
      [false, true],
    ];
    if (!tries.some(([strict, joining]) => draw(fact, strict, joining))) {
      restated.push(line);
    }
  }
  return {
    plan: drawn.length > 0 ? { ...plan, frames } : plan,
    drawn,
    restated,
  };
}
