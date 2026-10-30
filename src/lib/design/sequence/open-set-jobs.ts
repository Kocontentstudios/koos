/**
 * A brand's set and frame jobs that have not ended, as the server knows
 * them. Design Studio polls each one (which is what resumes a set past its
 * slice), so a set started on another device, in a private window or after
 * site data was cleared still finishes, and still shows as being made.
 */
import type { SequenceKind } from "./contract";
import { sequenceMarkOf } from "./progress-mark";

export type SetJobKind = "set" | "frame";

export interface OpenSetJob {
  jobId: string;
  kind: SetJobKind;
  sequenceKind: SequenceKind;
  /** Null until the set's plan is saved. */
  setId: string | null;
  /** ms since epoch. */
  startedAt: number;
}

/* Past this a set job has ended or will never be resumed (MAX_RESUMES
   slices of 300s is twenty minutes of work). */
export const OPEN_SET_JOB_WINDOW_MS = 60 * 60 * 1000;
export const MAX_OPEN_SET_JOBS = 20;

export interface OpenJobRow {
  id: string;
  status: string;
  result: unknown;
  createdAt: Date;
}

/* executeGenerationJob parks in-flight progress in the result column. */
function progressOf(result: unknown): unknown {
  return result && typeof result === "object" && "progress" in result
    ? (result as { progress: unknown }).progress
    : null;
}

/** The row as an open set job, or null for a finished job or one that is
 *  not building a set (a directions run carries no mark). */
export function openSetJobOf(row: OpenJobRow): OpenSetJob | null {
  if (row.status !== "pending" && row.status !== "running") return null;
  const mark = sequenceMarkOf(progressOf(row.result));
  if (!mark) return null;
  return {
    jobId: row.id,
    kind: mark.frameIndex === undefined ? "set" : "frame",
    sequenceKind: mark.sequenceKind,
    setId: mark.setId ?? null,
    startedAt: row.createdAt.getTime(),
  };
}

/** The listing as the client reads it: anything malformed is dropped, so a
 *  bad row never stops the rest being watched. */
export function parseOpenSetJobs(body: unknown): OpenSetJob[] {
  const jobs = (body as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.filter((value): value is OpenSetJob => {
    if (!value || typeof value !== "object") return false;
    const job = value as Record<string, unknown>;
    return (
      typeof job.jobId === "string" &&
      (job.kind === "set" || job.kind === "frame") &&
      (job.sequenceKind === "carousel" ||
        job.sequenceKind === "presentation") &&
      (job.setId === null || typeof job.setId === "string") &&
      typeof job.startedAt === "number"
    );
  });
}
