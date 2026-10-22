import {
  SUBJECT_COVERED,
  type SubjectBox,
} from "@/lib/design/document/subject";
import type { DesignSpec } from "@/lib/design/spec";
import { layoutCandidates } from "./layouts";

export interface LayoutChoice {
  spec: DesignSpec;
  /** The subject box the layout keeps clear, or null with none known. */
  subject: SubjectBox | null;
  /** SUBJECT_CROPPED when the best layout found could only keep the copy
   *  off the subject by drawing it small or cut; SUBJECT_COVERED when no
   *  layout could keep the copy off it at all. */
  fault: string | null;
  /** Documents built to decide. */
  tried: number;
}

/**
 * The layout a direction is drawn in, given the layouts its set already
 * holds and where the subject of its image is.
 *
 * Every layout already tries its own arrangements (copy low, copy high, the
 * subject in a band, an inset frame) before it reports the subject covered.
 * This tries the next layout when it does, so copy over the product is
 * re-laid out rather than delivered (round-2 live critic: headlines on the
 * pastry in three of four renders). Subjects are tried in order: the whole
 * subject, then a person's head and shoulders, which is the part copy may
 * never cover.
 */
export async function chooseLayout({
  spec,
  held,
  subjects,
  faultOf,
  relayout,
}: {
  spec: DesignSpec;
  held: readonly string[];
  subjects: readonly (SubjectBox | null)[];
  faultOf: (spec: DesignSpec, subject: SubjectBox) => Promise<string | null>;
  relayout: (spec: DesignSpec, layout: DesignSpec["layout"]) => DesignSpec;
}): Promise<LayoutChoice> {
  const specs = layoutCandidates(spec.layout, held).map((layout) =>
    layout === spec.layout ? spec : relayout(spec, layout),
  );
  const first = specs[0] ?? spec;
  const known = subjects.filter((s): s is SubjectBox => s !== null);
  if (known.length === 0) {
    return { spec: first, subject: null, fault: null, tried: 0 };
  }
  let tried = 0;
  let fallback: LayoutChoice | null = null;
  for (const subject of known) {
    for (const candidate of specs) {
      tried += 1;
      const fault = await faultOf(candidate, subject);
      if (!fault) return { spec: candidate, subject, fault: null, tried };
      if (fault !== SUBJECT_COVERED && !fallback) {
        fallback = { spec: candidate, subject, fault, tried: 0 };
      }
    }
  }
  return fallback
    ? { ...fallback, tried }
    : { spec: first, subject: known[0], fault: SUBJECT_COVERED, tried };
}
