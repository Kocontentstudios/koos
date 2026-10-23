import {
  SUBJECT_COVERED,
  SUBJECT_CROPPED,
  type SubjectBox,
} from "@/lib/design/document/subject";
import type { DesignSpec } from "@/lib/design/spec";
import type { CraftFaults } from "./craft";
import { layoutCandidates } from "./layouts";

/** Only a person's head and shoulders could be kept clear: the copy is on
 *  the rest of the subject (the tray, the dress, the product they hold). */
export const SUBJECT_FACE_ONLY =
  "the copy is kept off the person's face, but not off what they are holding or wearing";

/** No free layout draws the copy without a hard craft fault (craft.ts). */
export const LAYOUT_CRAFT_FAILED = "no layout draws this copy cleanly";

/** Every layout is taken by the direction's set. */
export class LayoutsHeldError extends Error {
  constructor() {
    super(
      "Every layout is already in use by this pair or a regenerate still running. Wait for it to finish, then try again.",
    );
    this.name = "LayoutsHeldError";
  }
}

/** What a built candidate shows: the subject rule's verdict on the box
 *  given, and its craft faults. */
export interface LayoutVerdict {
  subjectFault: string | null;
  craft: CraftFaults;
}

export interface LayoutChoice {
  spec: DesignSpec;
  /** The subject box the layout keeps clear, or null with none known. */
  subject: SubjectBox | null;
  /** The whole subject, which the delivered design is measured against
   *  whatever box the layout could keep clear. */
  wholeSubject: SubjectBox | null;
  /** The worst fault the choice is delivered with, or null:
   *  SUBJECT_COVERED or LAYOUT_CRAFT_FAILED when nothing can be delivered,
   *  else SUBJECT_FACE_ONLY, SUBJECT_CROPPED or a soft craft fault. */
  fault: string | null;
  /** Every fault the choice carries, for the usage row. */
  faults: string[];
  /** Documents built to decide. */
  tried: number;
}

/* Lower is better. A hard craft fault is never a candidate. */
function rank(verdict: LayoutVerdict, partialBox: boolean): number | null {
  if (verdict.craft.hard) return null;
  if (verdict.subjectFault === SUBJECT_COVERED) return null;
  const soft = verdict.craft.soft ? 1 : 0;
  if (partialBox) return 6 + soft;
  if (verdict.subjectFault === SUBJECT_CROPPED || verdict.subjectFault) {
    return 4 + soft;
  }
  return soft * 2;
}

/**
 * The layout a direction is drawn in, given the layouts its set already
 * holds and where the subject of its image is.
 *
 * Every layout already tries its own arrangements (copy low, copy high, the
 * subject in a band, an inset frame) before it reports the subject covered.
 * This tries every free layout against the whole subject and takes the
 * first that keeps the copy off it with no craft fault. Failing that, the
 * least bad one: a soft craft fault, then a cropped subject, then only the
 * head and shoulders kept clear. Each of those is delivered with its fault
 * recorded, never silently (round-3 code critic: the face-only fallback
 * laid the headline across a tray of croissants and recorded nothing). With
 * no free layout at all it throws LayoutsHeldError rather than reuse a
 * held one.
 */
export async function chooseLayout({
  spec,
  held,
  subjects,
  judge,
  relayout,
}: {
  spec: DesignSpec;
  held: readonly string[];
  /** The whole subject first, then a person's head and shoulders. */
  subjects: readonly (SubjectBox | null)[];
  judge: (
    spec: DesignSpec,
    subject: SubjectBox | null,
  ) => Promise<LayoutVerdict>;
  relayout: (spec: DesignSpec, layout: DesignSpec["layout"]) => DesignSpec;
}): Promise<LayoutChoice> {
  const layouts = layoutCandidates(spec.layout, held);
  if (layouts.length === 0) throw new LayoutsHeldError();
  const specs = layouts.map((layout) =>
    layout === spec.layout ? spec : relayout(spec, layout),
  );
  const known = subjects.filter((s): s is SubjectBox => s !== null);
  const whole = known[0] ?? null;
  const boxes: (SubjectBox | null)[] = known.length > 0 ? known : [null];
  let tried = 0;
  let best: { score: number; choice: LayoutChoice } | null = null;
  let craftBlocked = false;
  for (const [boxIndex, box] of boxes.entries()) {
    for (const candidate of specs) {
      tried += 1;
      const verdict = await judge(candidate, box);
      if (verdict.subjectFault !== SUBJECT_COVERED && verdict.craft.hard) {
        craftBlocked = true;
      }
      const score = rank(verdict, boxIndex > 0);
      if (score === null) continue;
      if (score === 0) {
        return {
          spec: candidate,
          subject: box,
          wholeSubject: whole,
          fault: null,
          faults: [],
          tried,
        };
      }
      if (!best || score < best.score) {
        const faults = [
          ...(boxIndex > 0 ? [SUBJECT_FACE_ONLY] : []),
          ...(verdict.subjectFault ? [verdict.subjectFault] : []),
          ...(verdict.craft.soft ? [verdict.craft.soft] : []),
        ];
        best = {
          score,
          choice: {
            spec: candidate,
            subject: box,
            wholeSubject: whole,
            fault: faults[0] ?? null,
            faults,
            tried: 0,
          },
        };
      }
    }
    /* A layout that keeps the whole subject clear, even cropped or with a
       soft fault, beats one that keeps only the face clear. */
    if (best) break;
  }
  if (best) return { ...best.choice, tried };
  /* Said for the reason a better photo or shorter copy would fix: a layout
     that cleared the subject but drew the copy badly is a copy problem. */
  const fault =
    known.length > 0 && !craftBlocked ? SUBJECT_COVERED : LAYOUT_CRAFT_FAILED;
  return {
    spec: specs[0],
    subject: whole,
    wholeSubject: whole,
    fault,
    faults: [fault],
    tried,
  };
}
