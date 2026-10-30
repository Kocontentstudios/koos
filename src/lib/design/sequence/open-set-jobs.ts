/**
 * A brand's set and frame jobs that have not ended, as the server knows
 * them. Design Studio polls each one (which is what resumes a set past its
 * slice), so a set started on another device, in a private window or after
 * site data was cleared still finishes, and still shows as being made.
 */
import { SEQUENCE_KINDS, type SequenceKind } from "./contract";
import { sequenceMarkOf } from "./progress-mark";

export type SetJobKind = "set" | "frame";

export interface OpenSetJob {
  jobId: string;
  kind: SetJobKind;
  /** Null until the job says, or its plan is saved. */
  sequenceKind: SequenceKind | null;
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
  input: unknown;
  result: unknown;
  createdAt: Date;
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function sequenceKindIn(value: unknown): SequenceKind | null {
  return (SEQUENCE_KINDS as readonly unknown[]).includes(value)
    ? (value as SequenceKind)
    : null;
}

/* What the job itself wrote, mark or none. executeGenerationJob parks
   in-flight progress and the checkpoint in the result column; the
   sequence job checkpoints { setId, plan } once its plan is saved. The
   generate route writes `sequence` into a set job's input, and the
   regenerate-frame route writes `regenerateFrame`. A directions run has
   neither. */
interface JobFacts {
  isSet: boolean;
  isFrame: boolean;
  checkpointSetId: string | null;
  checkpointKind: SequenceKind | null;
}

function factsOf(row: OpenJobRow): JobFacts {
  const sequence = field(row.input, "sequence");
  const checkpoint = field(row.result, "checkpoint");
  const setId = field(checkpoint, "setId");
  return {
    isSet: typeof field(sequence, "frames") === "number",
    isFrame: typeof field(row.input, "regenerateFrame") === "string",
    checkpointSetId: typeof setId === "string" && setId ? setId : null,
    checkpointKind: sequenceKindIn(field(field(checkpoint, "plan"), "kind")),
  };
}

/** The row as an open set job, or null for a finished job or one that is
 *  not building a set. The progress mark is trusted first; a job that has
 *  not put one on its progress is known by its input and checkpoint, so the
 *  list does not wait on the producer adopting the mark. */
export function openSetJobOf(row: OpenJobRow): OpenSetJob | null {
  if (row.status !== "pending" && row.status !== "running") return null;
  const mark = sequenceMarkOf(field(row.result, "progress"));
  const facts = factsOf(row);
  const startedAt = row.createdAt.getTime();
  if (mark) {
    return {
      jobId: row.id,
      kind: mark.frameIndex === undefined ? "set" : "frame",
      sequenceKind: mark.sequenceKind,
      setId: mark.setId ?? facts.checkpointSetId,
      startedAt,
    };
  }
  if (facts.isSet) {
    return {
      jobId: row.id,
      kind: "set",
      sequenceKind: facts.checkpointKind,
      setId: facts.checkpointSetId,
      startedAt,
    };
  }
  if (facts.isFrame) {
    return {
      jobId: row.id,
      kind: "frame",
      sequenceKind: null,
      setId: null,
      startedAt,
    };
  }
  return null;
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
      (job.sequenceKind === null ||
        sequenceKindIn(job.sequenceKind) !== null) &&
      (job.setId === null || typeof job.setId === "string") &&
      typeof job.startedAt === "number"
    );
  });
}
