/**
 * Stale-job policy for the /api/jobs/[id] poll route.
 *
 * Calendar jobs, and design jobs that build a carousel or presentation
 * (KOOS-AI-002), are checkpointed and resumable across serverless
 * invocations: the worker heartbeats every ~20s, so a short silence means
 * the invocation died (Vercel 300s kill, deploy) and the job should be
 * RESUMED from its checkpoint, not failed. Other jobs have nothing to
 * resume, so they keep the original long fail-only window.
 */

export type GenerationJobKind =
  | "strategy"
  | "calendar"
  | "design_brief"
  | "design_render";

/** Worker heartbeats every ~20s; 75s of silence = at least 3 missed beats. */
export const CALENDAR_STALE_MS = 75 * 1000;
/** Non-resumable kinds: generous window for one long model call. */
export const DEFAULT_STALE_MS = 4 * 60 * 1000;
/** A set-of-frames slice (KOOS-AI-002). The invocation is killed at 300s
 *  and a frame in flight at the deadline still has to finish (a KO plate,
 *  its retry and the render), so new frames stop starting well before. */
export const SEQUENCE_SLICE_BUDGET_MS = 210_000;
/** Resume attempts before the job genuinely fails. */
export const MAX_RESUMES = 3;

export type StaleAction = "none" | "resume" | "fail";

export function isSequenceJobInput(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const sequence = (input as { sequence?: unknown }).sequence;
  return (
    !!sequence &&
    typeof sequence === "object" &&
    typeof (sequence as { frames?: unknown }).frames === "number"
  );
}

/**
 * Whether a job's work can continue from a checkpoint. A design_render job
 * is resumable only when it builds a set of frames (its input carries
 * `sequence`); any other design job is one short render with nothing saved.
 */
export function isResumableJob(job: {
  kind: GenerationJobKind;
  input?: unknown;
}): boolean {
  if (job.kind === "calendar") return true;
  return job.kind === "design_render" && isSequenceJobInput(job.input);
}

export function staleMsFor(
  kind: GenerationJobKind,
  resumable = kind === "calendar",
): number {
  return resumable ? CALENDAR_STALE_MS : DEFAULT_STALE_MS;
}

/** Read the resume counter parked in the job's jsonb result column. */
export function resumeCountFrom(result: unknown): number {
  if (result && typeof result === "object" && "resumeCount" in result) {
    const n = (result as { resumeCount: unknown }).resumeCount;
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return 0;
}

export function resolveStaleAction(
  job: {
    kind: GenerationJobKind;
    status: string;
    updatedAt: Date;
    resumeCount: number;
    /** Defaults to the kind alone: calendar jobs resume. */
    resumable?: boolean;
  },
  now: number,
): StaleAction {
  const running = job.status === "pending" || job.status === "running";
  if (!running) return "none";
  const resumable = job.resumable ?? job.kind === "calendar";
  const silentMs = now - job.updatedAt.getTime();
  if (silentMs <= staleMsFor(job.kind, resumable)) return "none";
  if (!resumable) return "fail";
  return job.resumeCount < MAX_RESUMES ? "resume" : "fail";
}

/**
 * A worker that ends a slice deliberately parks `paused: true` in the job's
 * jsonb state. Unlike silence, this is positive evidence that the job is
 * ready to continue right now, so the poll route resumes it immediately
 * instead of waiting out the death-detection window.
 */
export function isPausedForResume(result: unknown): boolean {
  return (
    !!result &&
    typeof result === "object" &&
    (result as { paused?: unknown }).paused === true
  );
}
