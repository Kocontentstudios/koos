import type { SequenceKind } from "@/lib/design/sequence/contract";
import type { JobProgress } from "@/lib/generation/poll-job";
import { kindNoun } from "./set-model";

export type SequencePhase = "plan" | "render" | "checks";

export interface SequenceProgress {
  /** Known when the brief's design type said carousel or presentation;
   *  null when the run became a set without the client being told. */
  kind: SequenceKind | null;
  frameCount: number;
  phase: SequencePhase;
  /** Frames delivered so far. */
  done: number;
}

/* A directions run reports its total as the directions it makes (two, or one
   for a regenerate). A sequence run reports its frame count, and the
   smallest set past that is a three-frame one. So a total above two can only
   be a set. A two-frame carousel reads the same as a directions run and
   shows the directions wait; its result still opens as a set. */
const MOST_DIRECTIONS_PER_RUN = 2;

const PHASE_OF_STAGE: Partial<Record<string, SequencePhase>> = {
  brief: "plan",
  render: "render",
  checks: "checks",
};

/**
 * Reads the progress a sequence job already sends ({stage, done, total}) as
 * a set's progress. Null for anything a directions run could have sent, so
 * that wait keeps its own copy. The UI branches on stage and counts, never
 * on `label`, which is human text.
 */
export function readSequenceProgress(
  progress: JobProgress,
  expectedKind: SequenceKind | null,
): SequenceProgress | null {
  const phase = progress.stage ? PHASE_OF_STAGE[progress.stage] : undefined;
  if (!phase) return null;
  const frameCount = progress.total;
  if (!Number.isInteger(frameCount) || frameCount <= MOST_DIRECTIONS_PER_RUN) {
    return null;
  }
  return {
    kind: expectedKind,
    frameCount,
    phase,
    done: Math.max(0, Math.min(progress.done, frameCount)),
  };
}

/** The frame being worked on, 1-based: one past those already delivered. */
export function currentFrame(progress: SequenceProgress): number {
  return Math.min(progress.done + 1, progress.frameCount);
}

/** "carousel", "presentation", or "slides" when the kind is not known. */
export function setNoun(progress: SequenceProgress): string {
  return progress.kind ? kindNoun(progress.kind) : "slides";
}

export function sequenceProgressLine(progress: SequenceProgress): string {
  switch (progress.phase) {
    case "plan":
      return `Planning your ${setNoun(progress)}…`;
    case "render":
      return `Frame ${currentFrame(progress)} of ${progress.frameCount}…`;
    case "checks":
      return `Checking your ${setNoun(progress)}…`;
  }
}
