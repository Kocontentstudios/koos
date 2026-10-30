/**
 * KOOS-AI-002: what a sequence job adds to the progress it reports, so the
 * client knows from the first tick that the run is a set and of what kind.
 * A directions run reports {stage, done, total} too, and a two-frame
 * carousel's total is the same two a directions run reports, so the counts
 * alone cannot tell the two waits apart.
 *
 * Kept beside contract.ts rather than in it: the frozen contract has no
 * progress type. The client reads it with `sequenceMarkOf`, and
 * GET /api/design/set-jobs lists a brand's open set jobs by it.
 *
 * PRODUCER CONTRACT (KOOS-AI-002 U2, not yet emitted on this branch): the
 * sequence job spreads `sequenceMarkFor(kind, setId)` into every
 * reportProgress call, adding setId once the plan is saved; the
 * regenerate-frame job spreads `frameMarkFor(kind, setId, index)`. Until
 * they do, a set is known by the dialog's FEATURE_MULTI_FRAME hint and by
 * its frame counts (src/components/design/sequence/README.md).
 */
import { SEQUENCE_KINDS, type SequenceKind } from "./contract";

export interface SequenceProgressMark {
  sequenceKind: SequenceKind;
  /** Known once the plan is saved; lets a client that left the wait find the
   *  set this job is building. */
  setId?: string;
  /** Present only on a regenerate-frame job: the index it is redrawing. */
  frameIndex?: number;
}

export function sequenceMarkFor(
  kind: SequenceKind,
  setId?: string,
): SequenceProgressMark {
  return setId ? { sequenceKind: kind, setId } : { sequenceKind: kind };
}

export function frameMarkFor(
  kind: SequenceKind,
  setId: string,
  frameIndex: number,
): SequenceProgressMark {
  return { sequenceKind: kind, setId, frameIndex };
}

/** The mark on a progress report, or null when it carries none. */
export function sequenceMarkOf(progress: unknown): SequenceProgressMark | null {
  if (!progress || typeof progress !== "object") return null;
  const { sequenceKind, setId, frameIndex } = progress as Record<
    string,
    unknown
  >;
  if (!(SEQUENCE_KINDS as readonly unknown[]).includes(sequenceKind)) {
    return null;
  }
  const kind = sequenceKind as SequenceKind;
  const set = typeof setId === "string" && setId ? setId : undefined;
  if (set && Number.isInteger(frameIndex) && (frameIndex as number) >= 0) {
    return frameMarkFor(kind, set, frameIndex as number);
  }
  return sequenceMarkFor(kind, set);
}
