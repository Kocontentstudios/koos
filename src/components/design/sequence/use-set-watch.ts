"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  RegenerateFrameJobResult,
  SequenceJobResult,
  SequenceKind,
} from "@/lib/design/sequence/contract";
import {
  type OpenSetJob,
  parseOpenSetJobs,
  type SetJobKind,
} from "@/lib/design/sequence/open-set-jobs";
import { sequenceMarkOf } from "@/lib/design/sequence/progress-mark";
import type { SerializedGeneration } from "@/lib/design/serialize";
import type { JobStatusResponse } from "@/lib/generation/poll-job";
import { forgetSetJob, type SetJob, setJobsFor } from "./set-jobs";
import {
  type DesignSet,
  groupGallery,
  isBuilding,
  renderingIds,
} from "./set-model";

export const SET_WATCH_INTERVAL_MS = 3000;
/* The server's list of open set jobs changes only when a set starts
   somewhere else, so it is read far less often than the jobs are polled. */
export const SET_LIST_EVERY_TICKS = 5;
/* Past this a pending frame with no job of ours building it is not coming:
   a set's job is waited on for twenty minutes (SET_POLL_TIMEOUT_MS), and one
   nothing polls is never resumed. */
export const STALLED_AFTER_MS = 20 * 60 * 1000;

/** A set job of ours still running, as its last poll reported it. */
export interface LiveSetJob {
  jobId: string;
  /** From the job's progress mark, or what this browser knew at start. */
  setId: string | null;
  kind: SequenceKind | null;
  frameCount: number | null;
  done: number;
  /** Past planning: frames are being drawn. */
  rendering: boolean;
  /** ms since epoch. */
  startedAt: number;
}

export interface SetWatch {
  /** The rows given, with fresher reads in place and the rows of jobs that
   *  finished while watched added, newest first. */
  rows: SerializedGeneration[];
  /** Sets whose frames still pending will not arrive. */
  stalled: ReadonlySet<string>;
  /** Set jobs of ours still running. */
  live: LiveSetJob[];
}

/** A job being watched, from this browser's memory or the server's list. */
interface WatchedJob {
  jobId: string;
  kind: SetJobKind;
  sequenceKind: SequenceKind | null;
  setId: string | null;
  startedAt: number;
}

function fromLocal(job: SetJob): WatchedJob {
  return {
    jobId: job.jobId,
    kind: job.kind,
    sequenceKind: job.sequenceKind ?? null,
    setId: job.setId ?? null,
    startedAt: job.startedAt,
  };
}

function fromServer(job: OpenSetJob): WatchedJob {
  return {
    jobId: job.jobId,
    kind: job.kind,
    sequenceKind: job.sequenceKind,
    setId: job.setId,
    startedAt: job.startedAt,
  };
}

type Polled =
  | { state: "live"; job: LiveSetJob }
  | { state: "delivered"; ids: string[] }
  | { state: "ended" };

async function pollOnce(job: WatchedJob): Promise<Polled> {
  let res: Response;
  try {
    res = await fetch(`/api/jobs/${job.jobId}`);
  } catch {
    return { state: "live", job: liveOf(job, null) };
  }
  if (res.status >= 500) return { state: "live", job: liveOf(job, null) };
  if (!res.ok) return { state: "ended" };
  const data = (await res.json().catch(() => null)) as JobStatusResponse<
    SequenceJobResult | RegenerateFrameJobResult
  > | null;
  if (!data) return { state: "live", job: liveOf(job, null) };
  if (data.status === "failed") return { state: "ended" };
  if (data.status === "succeeded") {
    const result = data.result;
    if (result?.kind === "sequence") {
      return {
        state: "delivered",
        ids: [...result.generationIds, ...result.failed],
      };
    }
    if (result?.kind === "frame") {
      return { state: "delivered", ids: [result.generationId] };
    }
    return { state: "delivered", ids: [] };
  }
  return { state: "live", job: liveOf(job, data.progress ?? null) };
}

function liveOf(
  job: WatchedJob,
  progress: JobStatusResponse<unknown>["progress"] | null,
): LiveSetJob {
  const mark = sequenceMarkOf(progress);
  return {
    jobId: job.jobId,
    setId: mark?.setId ?? job.setId,
    kind: mark?.sequenceKind ?? job.sequenceKind,
    frameCount: progress?.total ?? null,
    done: progress?.done ?? 0,
    rendering: progress?.stage === "render" || progress?.stage === "checks",
    startedAt: job.startedAt,
  };
}

async function readRows(
  brandId: string,
  ids: string[],
): Promise<SerializedGeneration[]> {
  if (ids.length === 0) return [];
  try {
    const res = await fetch(
      `/api/design/generations?brandId=${brandId}&ids=${ids.join(",")}`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { generations?: SerializedGeneration[] };
    return body.generations ?? [];
  } catch {
    return [];
  }
}

async function listOpenJobs(brandId: string): Promise<OpenSetJob[] | null> {
  try {
    const res = await fetch(
      `/api/design/set-jobs?brandId=${encodeURIComponent(brandId)}`,
    );
    if (!res.ok) return null;
    return parseOpenSetJobs(await res.json());
  } catch {
    return null;
  }
}

/**
 * Which building sets have stopped. A set is still coming while a job of
 * ours runs that could be building it: one whose set is this one, or one
 * that has not said which set it builds. Otherwise it has stopped once a job
 * known to have been building THIS set ended without delivering it, or once
 * its oldest pending frame is past STALLED_AFTER_MS. A job that ended
 * without saying which set it built stops nothing: the set may belong to a
 * job running somewhere this browser cannot see, and a retry there would
 * bill a frame already on its way.
 */
export function stalledSets(
  sets: DesignSet[],
  live: LiveSetJob[],
  endedSets: ReadonlySet<string>,
  now: number,
): Set<string> {
  const stalled = new Set<string>();
  for (const set of sets) {
    if (!isBuilding(set)) continue;
    const covered = live.some((j) => !j.setId || j.setId === set.setId);
    if (covered) continue;
    const oldest = Math.min(
      ...set.frames.flatMap((slot) =>
        slot.generation && slot.generation.status !== "succeeded"
          ? [Date.parse(slot.generation.createdAt)]
          : [],
      ),
    );
    if (endedSets.has(set.setId) || now - oldest > STALLED_AFTER_MS) {
      stalled.add(set.setId);
    }
  }
  return stalled;
}

/* A set's first row is written after its job starts; this covers the
   clock between the browser that noted the start and the database. */
const CLAIM_SKEW_MS = 30_000;

function firstRowAt(set: DesignSet): number {
  return Math.min(
    ...set.frames.flatMap((slot) =>
      slot.generation ? [Date.parse(slot.generation.createdAt)] : [],
    ),
  );
}

/**
 * The live set jobs that need a placeholder card: those whose set has no
 * card of its own yet. A job that names its set is matched by id. One that
 * does not yet is matched to a set first written after it started that no
 * other job has claimed, so a job whose frames are already on a card does
 * not show twice, and another set still building does not hide a new one.
 */
export function placeholderJobs(
  live: LiveSetJob[],
  sets: DesignSet[],
): LiveSetJob[] {
  const claimed = new Set<string>();
  const unnamed: LiveSetJob[] = [];
  const waiting: LiveSetJob[] = [];
  for (const job of live) {
    if (!job.setId) {
      unnamed.push(job);
    } else if (sets.some((set) => set.setId === job.setId)) {
      claimed.add(job.setId);
    } else {
      waiting.push(job);
    }
  }
  /* Oldest job first, each taking the earliest set written after it: the
     order the sets were actually started in. */
  for (const job of [...unnamed].sort((a, b) => a.startedAt - b.startedAt)) {
    const match = sets
      .filter(
        (set) =>
          !claimed.has(set.setId) &&
          firstRowAt(set) >= job.startedAt - CLAIM_SKEW_MS,
      )
      .sort((a, b) => firstRowAt(a) - firstRowAt(b))[0];
    if (match) claimed.add(match.setId);
    else waiting.push(job);
  }
  return live.filter((job) => waiting.includes(job));
}

function overlay(
  given: SerializedGeneration[],
  fresh: ReadonlyMap<string, SerializedGeneration>,
): SerializedGeneration[] {
  const known = new Set(given.map((g) => g.id));
  const added = [...fresh.values()]
    .filter((g) => !known.has(g.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [...added, ...given.map((g) => fresh.get(g.id) ?? g)];
}

/**
 * Keeps Design Studio's sets moving after the wait that started them let
 * go. Every few seconds it polls the open set and frame jobs (which is also
 * what resumes a set past its 300s slice), reads again the frames still
 * pending, and adds what a finished job made. The jobs are the ones this
 * browser started plus the server's list for the brand, so a set started on
 * another device is driven here too. Between sets it reads only that list,
 * and only every SET_LIST_EVERY_TICKS ticks.
 */
export function useSetWatch(
  brandId: string | null,
  given: SerializedGeneration[],
): SetWatch {
  const [fresh, setFresh] = useState<ReadonlyMap<string, SerializedGeneration>>(
    new Map(),
  );
  const [live, setLive] = useState<LiveSetJob[]>([]);
  const [endedSets, setEndedSets] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  const rows = useMemo(() => overlay(given, fresh), [given, fresh]);
  const sets = useMemo(
    () =>
      brandId
        ? groupGallery(brandId, rows).flatMap((item) =>
            item.type === "set" ? [item.set] : [],
          )
        : [],
    [brandId, rows],
  );
  const stalled = useMemo(
    () => stalledSets(sets, live, endedSets, now),
    [sets, live, endedSets, now],
  );

  const latest = useRef({ sets, stalled });
  latest.current = { sets, stalled };

  useEffect(() => {
    if (!brandId) return;
    const brand = brandId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ticks = 0;
    /* Kept until a poll sees the job end, not until the list drops it: a
       job that ends between two reads of the list still hands over the
       frames it made. */
    const listed = new Map<string, WatchedJob>();
    /* The set each job was last seen building, so its end stops that set
       and no other. */
    const setOfJob = new Map<string, string>();

    function watched(): WatchedJob[] {
      const jobs = new Map(listed);
      for (const job of setJobsFor(brand)) {
        const mine = fromLocal(job);
        const theirs = jobs.get(job.jobId);
        jobs.set(job.jobId, {
          ...mine,
          setId: mine.setId ?? theirs?.setId ?? null,
          sequenceKind: mine.sequenceKind ?? theirs?.sequenceKind ?? null,
        });
      }
      return [...jobs.values()];
    }

    async function refreshList() {
      const open = await listOpenJobs(brand);
      if (cancelled || !open) return;
      for (const job of open) listed.set(job.jobId, fromServer(job));
    }

    async function tick() {
      const active =
        latest.current.sets.some(isBuilding) || watched().length > 0;
      if (ticks % SET_LIST_EVERY_TICKS === 0 && (ticks === 0 || active)) {
        await refreshList();
        if (cancelled) return;
      }
      ticks += 1;

      const jobs = watched();
      for (const job of jobs) {
        if (job.setId) setOfJob.set(job.jobId, job.setId);
      }
      const pendingIds = latest.current.sets
        .filter((set) => !latest.current.stalled.has(set.setId))
        .flatMap(renderingIds);
      if (jobs.length > 0 || pendingIds.length > 0) {
        const polled = await Promise.all(jobs.map(pollOnce));
        if (cancelled) return;
        const nextLive: LiveSetJob[] = [];
        const delivered: string[] = [];
        const stopped: string[] = [];
        polled.forEach((outcome, i) => {
          const job = jobs[i] as WatchedJob;
          if (outcome.state === "live") {
            if (outcome.job.setId) {
              setOfJob.set(job.jobId, outcome.job.setId);
            }
            if (job.kind === "set") nextLive.push(outcome.job);
            return;
          }
          forgetSetJob(job.jobId);
          listed.delete(job.jobId);
          if (outcome.state === "delivered") {
            delivered.push(...outcome.ids);
          } else if (job.kind === "set") {
            /* A failed frame job speaks for its one frame, which keeps its
               old row; the set's other frames are its set job's to end. */
            const setId = setOfJob.get(job.jobId);
            if (setId) stopped.push(setId);
          }
          setOfJob.delete(job.jobId);
        });
        const read = await readRows(brand, [
          ...new Set([...pendingIds, ...delivered]),
        ]);
        if (cancelled) return;
        setLive(nextLive);
        if (stopped.length > 0) {
          setEndedSets((held) => new Set([...held, ...stopped]));
        }
        if (read.length > 0) {
          setFresh((held) => {
            const next = new Map(held);
            for (const row of read) next.set(row.id, row);
            return next;
          });
        }
      }
      if (latest.current.sets.some(isBuilding)) setNow(Date.now());
      timer = setTimeout(() => void tick(), SET_WATCH_INTERVAL_MS);
    }

    /* Coming back to the tab is when a set started on the phone meanwhile
       is most likely; read the list then rather than waiting for a tick. */
    function onVisible() {
      if (document.visibilityState === "visible") void refreshList();
    }

    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [brandId]);

  return { rows, stalled, live };
}
