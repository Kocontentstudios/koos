/**
 * KOOS-AI-002: what a sequence job adds to the progress it reports, so the
 * client knows from the first tick that the run is a set and of what kind.
 * A directions run reports {stage, done, total} too, and a two-frame
 * carousel's total is the same two a directions run reports, so the counts
 * alone cannot tell the two waits apart.
 *
 * Kept beside contract.ts rather than in it: the frozen contract has no
 * progress type. The server's report() spreads `sequenceMarkFor(...)` into
 * every reportProgress call; the client reads it with `sequenceMarkOf`.
 */
import { SEQUENCE_KINDS, type SequenceKind } from "./contract";

export interface SequenceProgressMark {
  sequenceKind: SequenceKind;
  /** Known once the plan is saved; lets a client that left the wait find the
   *  set this job is building. */
  setId?: string;
}

export function sequenceMarkFor(
  kind: SequenceKind,
  setId?: string,
): SequenceProgressMark {
  return setId ? { sequenceKind: kind, setId } : { sequenceKind: kind };
}

/** The mark on a progress report, or null when it carries none. */
export function sequenceMarkOf(progress: unknown): SequenceProgressMark | null {
  if (!progress || typeof progress !== "object") return null;
  const { sequenceKind, setId } = progress as Record<string, unknown>;
  if (!(SEQUENCE_KINDS as readonly unknown[]).includes(sequenceKind)) {
    return null;
  }
  return sequenceMarkFor(
    sequenceKind as SequenceKind,
    typeof setId === "string" && setId ? setId : undefined,
  );
}
