/**
 * Stale-job policy for the /api/jobs/[id] poll route.
 *
 * Calendar jobs are checkpointed and resumable across serverless
 * invocations: the worker heartbeats every ~20s, so a short silence means
 * the invocation died (Vercel 300s kill, deploy) and the job should be
 * RESUMED from its checkpoint, not failed. Other kinds are a single model
 * call with nothing to resume, so they keep the original long fail-only
 * window.
 */

export type GenerationJobKind = "strategy" | "calendar" | "design_brief";

/** Worker heartbeats every ~20s; 75s of silence = at least 3 missed beats. */
export const CALENDAR_STALE_MS = 75 * 1000;
/** Non-resumable kinds: generous window for one long model call. */
export const DEFAULT_STALE_MS = 4 * 60 * 1000;
/** Resume attempts before the job genuinely fails. */
export const MAX_RESUMES = 3;

export type StaleAction = "none" | "resume" | "fail";

export function staleMsFor(kind: GenerationJobKind): number {
  return kind === "calendar" ? CALENDAR_STALE_MS : DEFAULT_STALE_MS;
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
  },
  now: number,
): StaleAction {
  const running = job.status === "pending" || job.status === "running";
  if (!running) return "none";
  const silentMs = now - job.updatedAt.getTime();
  if (silentMs <= staleMsFor(job.kind)) return "none";
  if (job.kind !== "calendar") return "fail";
  return job.resumeCount < MAX_RESUMES ? "resume" : "fail";
}
