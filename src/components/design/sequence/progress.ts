import {
  FRAME_BOUNDS,
  type SequenceKind,
} from "@/lib/design/sequence/contract";
import { sequenceMarkOf } from "@/lib/design/sequence/progress-mark";
import type { JobProgress } from "@/lib/generation/poll-job";
import { kindNoun } from "./set-model";

export type SequencePhase = "plan" | "render" | "checks";

export interface SequenceProgress {
  /** Null when the run became a set without anything naming its kind. */
  kind: SequenceKind | null;
  /** Null until the job reports its count. */
  frameCount: number | null;
  phase: SequencePhase;
  /** Frames delivered so far. */
  done: number;
}

/* With neither a mark nor a known kind, the counts are all there is: a
   directions run reports a total of two at most (one for a regenerate), and
   the smallest set past that is three frames. */
const MOST_DIRECTIONS_PER_RUN = 2;

const PHASE_OF_STAGE: Partial<Record<string, SequencePhase>> = {
  brief: "plan",
  render: "render",
  checks: "checks",
};

function isSetTotal(total: number, kind: SequenceKind | null): boolean {
  if (!Number.isInteger(total)) return false;
  return kind
    ? total >= FRAME_BOUNDS[kind].min
    : total > MOST_DIRECTIONS_PER_RUN;
}

/**
 * Reads a job's progress as a set's, or null for anything a directions run
 * could have sent, so that wait keeps its own copy. The job's mark
 * (progress-mark.ts) settles it; failing that, `expectedKind`, which the
 * caller passes only when FEATURE_MULTI_FRAME is on and the brief names a
 * carousel or presentation, so the server is certain to build a set. The UI
 * branches on stage and counts, never on `label`, which is human text.
 */
export function readSequenceProgress(
  progress: JobProgress,
  expectedKind: SequenceKind | null,
): SequenceProgress | null {
  const phase = progress.stage ? PHASE_OF_STAGE[progress.stage] : undefined;
  if (!phase) return null;
  const kind = sequenceMarkOf(progress)?.sequenceKind ?? expectedKind;
  const frameCount = progress.total;
  if (!isSetTotal(frameCount, kind)) return null;
  return {
    kind,
    frameCount,
    phase,
    done: Math.max(0, Math.min(progress.done, frameCount)),
  };
}

/**
 * The wait a known set opens on, before the job's first report. An approved
 * outline already fixes the count, so the wait can say it from the start.
 */
export function plannedProgress(
  kind: SequenceKind,
  frameCount: number | null = null,
): SequenceProgress {
  return { kind, frameCount, phase: "plan", done: 0 };
}

/** The frame being worked on, 1-based: one past those already delivered. */
export function currentFrame(progress: SequenceProgress): number {
  const next = progress.done + 1;
  return progress.frameCount ? Math.min(next, progress.frameCount) : next;
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
      return progress.frameCount
        ? `Frame ${currentFrame(progress)} of ${progress.frameCount}…`
        : `Frame ${currentFrame(progress)}…`;
    case "checks":
      return `Checking your ${setNoun(progress)}…`;
  }
}
