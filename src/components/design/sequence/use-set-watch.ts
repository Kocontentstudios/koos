"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  RegenerateFrameJobResult,
  SequenceJobResult,
  SequenceKind,
} from "@/lib/design/sequence/contract";
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
/* Past this a pending frame with no job of ours building it is not coming:
   a set's job is waited on for twenty minutes (SET_POLL_TIMEOUT_MS), and one
   nothing polls is never resumed. */
export const STALLED_AFTER_MS = 20 * 60 * 1000;

/** A set job of ours still running, as its last poll reported it. */
export interface LiveSetJob {
  jobId: string;
  /** From the job's progress mark, when the server stamps one. */
  setId: string | null;
  kind: SequenceKind | null;
  frameCount: number | null;
  done: number;
  /** Past planning: frames are being drawn. */
  rendering: boolean;
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

type Polled =
  | { state: "live"; job: LiveSetJob }
  | { state: "delivered"; ids: string[] }
  | { state: "ended"; kind: SetJob["kind"] };

async function pollOnce(job: SetJob): Promise<Polled> {
  let res: Response;
  try {
    res = await fetch(`/api/jobs/${job.jobId}`);
  } catch {
    return { state: "live", job: liveOf(job, null) };
  }
  if (res.status >= 500) return { state: "live", job: liveOf(job, null) };
  if (!res.ok) return { state: "ended", kind: job.kind };
  const data = (await res.json().catch(() => null)) as JobStatusResponse<
    SequenceJobResult | RegenerateFrameJobResult
  > | null;
  if (!data) return { state: "live", job: liveOf(job, null) };
  if (data.status === "failed") return { state: "ended", kind: job.kind };
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
  job: SetJob,
  progress: JobStatusResponse<unknown>["progress"] | null,
): LiveSetJob {
  const mark = sequenceMarkOf(progress);
  return {
    jobId: job.jobId,
    setId: mark?.setId ?? null,
    kind: mark?.sequenceKind ?? null,
    frameCount: progress?.total ?? null,
    done: progress?.done ?? 0,
    rendering: progress?.stage === "render" || progress?.stage === "checks",
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

/**
 * Which building sets have stopped. A set is still coming while a set job
 * of ours runs that could be building it (its mark names it, or names
 * none). Without one it has stopped once a set job of ours ended without
 * delivering, or once its oldest pending frame is past STALLED_AFTER_MS.
 */
export function stalledSets(
  sets: DesignSet[],
  live: LiveSetJob[],
  setJobEnded: boolean,
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
    if (setJobEnded || now - oldest > STALLED_AFTER_MS) stalled.add(set.setId);
  }
  return stalled;
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
 * go. Every few seconds it polls the set and frame jobs this browser
 * started (which is also what resumes a set past its 300s slice), reads
 * again the frames still pending, and adds what a finished job made. It
 * does nothing on the network while there is nothing to watch.
 */
export function useSetWatch(
  brandId: string | null,
  given: SerializedGeneration[],
): SetWatch {
  const [fresh, setFresh] = useState<ReadonlyMap<string, SerializedGeneration>>(
    new Map(),
  );
  const [live, setLive] = useState<LiveSetJob[]>([]);
  const [setJobEnded, setSetJobEnded] = useState(false);
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
    () => stalledSets(sets, live, setJobEnded, now),
    [sets, live, setJobEnded, now],
  );

  const latest = useRef({ sets, stalled });
  latest.current = { sets, stalled };

  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      const jobs = setJobsFor(brandId as string);
      const pendingIds = latest.current.sets
        .filter((set) => !latest.current.stalled.has(set.setId))
        .flatMap(renderingIds);
      if (jobs.length > 0 || pendingIds.length > 0) {
        const polled = await Promise.all(jobs.map(pollOnce));
        if (cancelled) return;
        const nextLive: LiveSetJob[] = [];
        const delivered: string[] = [];
        let ended = false;
        polled.forEach((outcome, i) => {
          const job = jobs[i] as SetJob;
          if (outcome.state === "live") {
            if (job.kind === "set") nextLive.push(outcome.job);
            return;
          }
          forgetSetJob(job.jobId);
          if (outcome.state === "delivered") delivered.push(...outcome.ids);
          else if (outcome.kind === "set") ended = true;
        });
        const read = await readRows(brandId as string, [
          ...new Set([...pendingIds, ...delivered]),
        ]);
        if (cancelled) return;
        setLive(nextLive);
        if (ended) setSetJobEnded(true);
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

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [brandId]);

  return { rows, stalled, live };
}
