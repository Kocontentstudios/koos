import { COPY_TARGETS, DRAFT_LIMITS } from "@/lib/jobs/directions/schema";
import type { FrameBeat, PlannedSequence } from "./contract";

/**
 * One footer system per set (H2). The copy call writes footer lines frame
 * by frame, so a set came out with a date bar on one body slide, none on
 * the next and three lines on the close (integration round 2, MEDIUM 3).
 * The plan decides it once instead: the brief's lines live on the action
 * frame, where the reader looks to act, and every other frame draws no
 * footer. A line the action already says is not said twice.
 *
 * A full footer takes a line beside its shortest one ("our Yaba bar · 8am
 * to 2pm"), the way the copy already pairs a place and a time. All or
 * nothing: when even that does not fit, the set is returned as it was,
 * since half a move is still two footer systems.
 */

const MAX_FOOTER_LINES = DRAFT_LIMITS.footerLines;
const LINE_CHARS = COPY_TARGETS.footerLine.chars;
const PAIRED = " · ";

/* A price, a phone number, an address or a link reads as its own line:
   "₦2,500 a bottle · 8am to 2pm" reads as the price having hours. */
const STANDS_ALONE =
  /[₦$£€]|\bN\d|\d{3}[\s-]?\d{3}[\s-]?\d{3,4}|@|https?:|\w\.\w{2,}\//u;

/** `lines` with `line` beside the shortest one it fits beside, or null. */
function paired(lines: readonly string[], line: string): string[] | null {
  if (STANDS_ALONE.test(line)) return null;
  const shortest = [...lines.keys()]
    .filter(
      (i) =>
        !STANDS_ALONE.test(lines[i]) &&
        `${lines[i]}${PAIRED}${line}`.length <= LINE_CHARS,
    )
    .sort((a, b) => lines[a].length - lines[b].length)[0];
  if (shortest === undefined) return null;
  return lines.map((l, i) => (i === shortest ? `${l}${PAIRED}${line}` : l));
}

const flat = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function saidOn(beat: FrameBeat, line: string): boolean {
  const said = flat(
    [beat.headline, beat.subheadline, beat.cta, ...beat.footerLines].join(
      " \n ",
    ),
  );
  return said.includes(flat(line).replace(/[.]+$/, ""));
}

/** Whether every footer line of the set is on its action frame. */
export function hasOneFooterSystem(frames: readonly FrameBeat[]): boolean {
  return frames.every(
    (beat, i) => i === frames.length - 1 || beat.footerLines.length === 0,
  );
}

export function withOneFooterSystem(plan: PlannedSequence): PlannedSequence {
  const last = plan.frames.length - 1;
  const action = plan.frames[last];
  if (action?.role !== "cta" || hasOneFooterSystem(plan.frames)) {
    return plan;
  }
  let lines = [...action.footerLines];
  for (const beat of plan.frames.slice(0, last)) {
    for (const line of beat.footerLines) {
      if (saidOn({ ...action, footerLines: lines }, line)) continue;
      if (lines.length < MAX_FOOTER_LINES) {
        lines.push(line);
        continue;
      }
      const beside = paired(lines, line);
      if (!beside) return plan;
      lines = beside;
    }
  }
  return {
    ...plan,
    frames: plan.frames.map((beat, i) =>
      i === last
        ? { ...beat, footerLines: lines }
        : { ...beat, footerLines: [] },
    ),
  };
}
