/**
 * The set and frame jobs this browser started and has not seen end.
 *
 * The server lists a brand's open set jobs too (GET /api/design/set-jobs),
 * read every few ticks. This copy covers a job's first seconds before that
 * list is read again, and carries what this browser already knows: a frame
 * job's set, and the kind the dialog expected before any plan is saved.
 */
import type { SequenceKind } from "@/lib/design/sequence/contract";
import type { SetJobKind } from "@/lib/design/sequence/open-set-jobs";

export type { SetJobKind };

export interface SetJob {
  jobId: string;
  brandId: string;
  kind: SetJobKind;
  sequenceKind?: SequenceKind;
  setId?: string;
  /** ms since epoch. */
  startedAt: number;
}

const KEY = "koos.design.setJobs.v1";
/* Past this a job has either ended or will never be resumed (MAX_RESUMES
   slices of 300s is twenty minutes of work); polling it again only gets
   its 404 or its end. */
export const SET_JOB_TTL_MS = 60 * 60 * 1000;

function isSetJob(value: unknown): value is SetJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.jobId === "string" &&
    typeof job.brandId === "string" &&
    (job.kind === "set" || job.kind === "frame") &&
    typeof job.startedAt === "number" &&
    (job.sequenceKind === undefined ||
      job.sequenceKind === "carousel" ||
      job.sequenceKind === "presentation") &&
    (job.setId === undefined || typeof job.setId === "string")
  );
}

/* Storage can be missing or throw (private mode, blocked site data); every
   caller then simply has no remembered jobs. */
function readAll(now: number): SetJob[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter(isSetJob)
          .filter((j) => now - j.startedAt < SET_JOB_TTL_MS)
      : [];
  } catch {
    return [];
  }
}

function writeAll(jobs: SetJob[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(jobs));
  } catch {
    /* Nothing to fall back to: the job still runs, it just is not resumed
       from another page. */
  }
}

export function rememberSetJob(
  job: Omit<SetJob, "startedAt">,
  now = Date.now(),
) {
  const jobs = readAll(now).filter((j) => j.jobId !== job.jobId);
  writeAll([...jobs, { ...job, startedAt: now }]);
}

export function forgetSetJob(jobId: string, now = Date.now()) {
  const jobs = readAll(now);
  if (jobs.some((j) => j.jobId === jobId)) {
    writeAll(jobs.filter((j) => j.jobId !== jobId));
  }
}

export function setJobsFor(brandId: string, now = Date.now()): SetJob[] {
  return readAll(now).filter((j) => j.brandId === brandId);
}
