import {
  SUBJECT_COVERED,
  SUBJECT_CROPPED,
  type SubjectBox,
} from "@/lib/design/document/subject";
import type { DesignSpec } from "@/lib/design/spec";
import { type CraftFaults, IMAGE_AGAINST_EDGE } from "./craft";
import { layoutCandidates } from "./layouts";

/** Only a person's head and shoulders could be kept clear: the copy is on
 *  the rest of the subject (the tray, the dress, the product they hold). */
export const SUBJECT_FACE_ONLY =
  "the copy is kept off the person's face, but not off what they are holding or wearing";

/** The design has an image but where its subject is could not be found:
 *  the look at the photo was unavailable, or found only a face. The copy
 *  is laid out without knowing what it might cover, and that is recorded
 *  (round-4 code critic: a face taken for the whole subject let the
 *  headline cross a tray of croissants with nothing recorded). */
export const SUBJECT_UNKNOWN =
  "where the product is in the image could not be found, so the copy may sit on it";

/* A layout that keeps a half or a band for the picture draws an empty
   accent panel there without one (round-4 live critic: event-ko shipped
   half its canvas an empty orange gradient). With no image only these are
   tried. */
export const TEXT_LED_LAYOUTS: readonly DesignSpec["layout"][] = [
  "hero-center",
  "stat-highlight",
  "quote-card",
];

/** Both directions put the same photo in the same place: two cards that
 *  read as one design (round-4 live critic, cafe and fashion). */
export const SAME_SHAPE_AS_SIBLING =
  "drawn in the same shape as its sibling: the same photo in the same place";

/* Layouts drawn by one builder with one composition: stat-highlight and
   quote-card are both a centred card of copy, and two text-led directions
   in them read as one template in two colourways (round-8 live critic,
   event). */
const COMPOSITION: Partial<Record<DesignSpec["layout"], string>> = {
  "stat-highlight": "card",
  "quote-card": "card",
};

/** Two layouts that draw one composition. */
export function sameComposition(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = COMPOSITION[a as DesignSpec["layout"]];
  return ca !== undefined && ca === COMPOSITION[b as DesignSpec["layout"]];
}

/** A text-led direction drawn in the same composition as its sibling. */
export const SAME_COMPOSITION_AS_SIBLING =
  "laid out in the same composition as its sibling: one template in two colourways";

/** Where a design draws its picture, and how it stands to the headline. */
export interface PhotoPlace {
  box: SubjectBox;
  arrangement: "behind" | "above" | "below" | "beside";
}

/* Overlap of two picture frames, as a share of their union, past which two
   designs read as one shape even in different arrangements. */
const SAME_SHAPE_IOU = 0.6;

function sameShape(a: PhotoPlace, b: PhotoPlace): boolean {
  return (
    a.arrangement === b.arrangement ||
    overlapShare(a.box, b.box) >= SAME_SHAPE_IOU
  );
}

function overlapShare(a: SubjectBox, b: SubjectBox): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const shared = w * h;
  const union = a.w * a.h + b.w * b.h - shared;
  return union > 0 ? shared / union : 0;
}

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
  /** Where the built document draws its picture. */
  place?: PhotoPlace | null;
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
  /** Where the chosen layout draws its picture, for its sibling to keep
   *  apart from. */
  place: PhotoPlace | null;
  /** Every layout judged and what each would have carried, so a delivered
   *  fault can be shown to have had no clean alternative. */
  considered: ConsideredLayout[];
}

export interface ConsideredLayout {
  layout: DesignSpec["layout"];
  /** Kept only the head and shoulders clear. */
  faceOnly: boolean;
  subjectFault: string | null;
  hard: string | null;
  soft: string | null;
}

/** A layout that shows the whole subject uncut and clear, with no hard
 *  fault and its picture off the card's edge: what a flush photo is
 *  delivered only in the absence of. */
export function isCleanAlternative(layout: ConsideredLayout): boolean {
  return (
    !layout.faceOnly &&
    !layout.subjectFault &&
    !layout.hard &&
    layout.soft !== IMAGE_AGAINST_EDGE
  );
}

/* Lower is better. A hard craft fault is never a candidate. */
function rank(
  verdict: LayoutVerdict,
  partialBox: boolean,
  sameShape: boolean,
): number | null {
  if (verdict.craft.hard) return null;
  if (verdict.subjectFault === SUBJECT_COVERED) return null;
  const soft = verdict.craft.soft || sameShape ? 1 : 0;
  if (partialBox) return 6 + soft;
  if (verdict.subjectFault === SUBJECT_CROPPED || verdict.subjectFault) {
    return 4 + soft;
  }
  /* A photo flush against its card's edge reads as a mistake where a
     headline that does not lead reads as a choice (round-6 eval, run b:
     textile quote-card, every inset cropping), so any other layout with a
     whole subject is taken first. */
  if (verdict.craft.soft === IMAGE_AGAINST_EDGE) return 3;
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
  imageless = false,
  apartFrom = null,
  apartLayout = null,
}: {
  spec: DesignSpec;
  held: readonly string[];
  /** The whole subject first (null when it could not be found), then a
   *  person's head and shoulders. Empty with no image. */
  subjects: readonly (SubjectBox | null)[];
  /** The design is drawn with no image: only text-led layouts. */
  imageless?: boolean;
  /** Where the sibling draws the same photo: a layout that puts it in the
   *  same place is taken only when nothing else is clean. */
  apartFrom?: PhotoPlace | null;
  /** The sibling's layout: with no image, one in the same composition is
   *  taken only when nothing else is clean. */
  apartLayout?: string | null;
  judge: (
    spec: DesignSpec,
    subject: SubjectBox | null,
  ) => Promise<LayoutVerdict>;
  relayout: (spec: DesignSpec, layout: DesignSpec["layout"]) => DesignSpec;
}): Promise<LayoutChoice> {
  const layouts = layoutCandidates(spec.layout, held).filter(
    (layout) => !imageless || TEXT_LED_LAYOUTS.includes(layout),
  );
  if (layouts.length === 0) throw new LayoutsHeldError();
  const specs = layouts.map((layout) =>
    layout === spec.layout ? spec : relayout(spec, layout),
  );
  const whole = subjects[0] ?? null;
  const unknown = subjects.length > 0 && whole === null;
  const known = subjects.filter((s): s is SubjectBox => s !== null);
  /* A face alone is never the whole subject: it is still kept clear, as
     the one part known, but the choice says the rest is unknown. */
  const boxes: (SubjectBox | null)[] = known.length > 0 ? known : [null];
  const unknownFault = unknown ? [SUBJECT_UNKNOWN] : [];
  let tried = 0;
  const considered: ConsideredLayout[] = [];
  let best: { score: number; choice: LayoutChoice } | null = null;
  let craftBlocked = false;
  for (const [boxIndex, box] of boxes.entries()) {
    for (const candidate of specs) {
      tried += 1;
      const verdict = await judge(candidate, box);
      if (verdict.subjectFault !== SUBJECT_COVERED && verdict.craft.hard) {
        craftBlocked = true;
      }
      const partial = boxIndex > 0 && !unknown;
      considered.push({
        layout: candidate.layout,
        faceOnly: partial,
        subjectFault: verdict.subjectFault,
        hard: verdict.craft.hard,
        soft: verdict.craft.soft,
      });
      const looksAlike = Boolean(
        apartFrom && verdict.place && sameShape(apartFrom, verdict.place),
      );
      const readsAlike =
        imageless &&
        apartLayout !== null &&
        sameComposition(apartLayout, candidate.layout);
      const score = rank(verdict, partial, looksAlike || readsAlike);
      if (score === null) continue;
      if (score === 0) {
        return {
          spec: candidate,
          subject: box,
          wholeSubject: whole,
          fault: unknownFault[0] ?? null,
          faults: unknownFault,
          tried,
          place: verdict.place ?? null,
          considered,
        };
      }
      if (!best || score < best.score) {
        const faults = [
          ...unknownFault,
          ...(partial ? [SUBJECT_FACE_ONLY] : []),
          ...(verdict.subjectFault ? [verdict.subjectFault] : []),
          ...(verdict.craft.soft ? [verdict.craft.soft] : []),
          ...(looksAlike ? [SAME_SHAPE_AS_SIBLING] : []),
          ...(readsAlike ? [SAME_COMPOSITION_AS_SIBLING] : []),
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
            place: verdict.place ?? null,
            considered: [],
          },
        };
      }
    }
    /* A layout that keeps the whole subject clear, even cropped or with a
       soft fault, beats one that keeps only the face clear. */
    if (best) break;
  }
  if (best) return { ...best.choice, tried, considered };
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
    place: null,
    considered,
  };
}
