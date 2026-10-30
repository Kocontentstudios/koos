import {
  SEQUENCE_KINDS,
  type SequenceKind,
} from "@/lib/design/sequence/contract";
import type { JobProgress } from "@/lib/generation/poll-job";
import { kindNoun } from "./set-model";

/**
 * What a sequence job adds to the progress it reports, so the client knows a
 * set is being made before the result says so. The UI branches on this and
 * never on `label`, which is human text.
 */
export interface SequenceProgressMark {
  kind: SequenceKind;
  frameCount: number;
  phase: "plan" | "render";
}

export interface SequenceProgress extends SequenceProgressMark {
  /** Frames delivered so far. */
  done: number;
}

export function readSequenceProgress(
  progress: JobProgress,
): SequenceProgress | null {
  const mark = (progress as JobProgress & { sequence?: unknown }).sequence;
  if (!mark || typeof mark !== "object") return null;
  const { kind, frameCount, phase } = mark as Record<string, unknown>;
  if (
    !(SEQUENCE_KINDS as readonly unknown[]).includes(kind) ||
    typeof frameCount !== "number" ||
    frameCount < 1 ||
    (phase !== "plan" && phase !== "render")
  ) {
    return null;
  }
  return {
    kind: kind as SequenceKind,
    frameCount,
    phase,
    done: Math.max(0, Math.min(progress.done, frameCount)),
  };
}

/** The frame being worked on, 1-based: one past those already delivered. */
export function currentFrame(progress: SequenceProgress): number {
  return Math.min(progress.done + 1, progress.frameCount);
}

export function sequenceProgressLine(progress: SequenceProgress): string {
  if (progress.phase === "plan") {
    return `Planning your ${kindNoun(progress.kind)}…`;
  }
  return `Frame ${currentFrame(progress)} of ${progress.frameCount}…`;
}
