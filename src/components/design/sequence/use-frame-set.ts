"use client";

import { useCallback, useRef, useState } from "react";
import type {
  FrameEdits,
  RegenerateFrameJobResult,
} from "@/lib/design/sequence/contract";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { stoppedWaiting } from "@/lib/generation/poll-errors";
import { pollGenerationJob } from "@/lib/generation/poll-job";
import { forgetSetJob, rememberSetJob } from "./set-jobs";
import { type DesignSet, mergeSets, swapFrame } from "./set-model";

/** The pending key of one frame's regenerate, keyed to the row it replaces
 *  so only that frame claims to be working. */
export function regenKey(generationId: string): string {
  return `regen:${generationId}`;
}

/** Said in place of "didn't work" when the client stopped waiting on a
 *  frame whose job may still deliver. */
export const FRAME_STILL_RUNNING =
  "This frame is taking longer than usual. It's still being made; keep waiting, or close this and it will appear in Design Studio when it's done.";

export interface FrameSetState {
  set: DesignSet | null;
  /** Puts a set on screen, clearing every frame action. */
  load: (set: DesignSet | null) => void;
  /** A fresher read of the set on screen: frames regenerating here keep
   *  their pending state and a frame already swapped in is kept. */
  refresh: (set: DesignSet) => void;
  /** Resolves to the frame's new row, or null when it did not come back; the
   *  old frame stays on show either way until a new one exists. */
  regenerateFrame: (
    generationId: string,
    edits?: FrameEdits,
  ) => Promise<SerializedGeneration | null>;
  /** Watches again a frame job the client stopped waiting on, rather than
   *  posting (and billing) a second one. */
  keepWaiting: (index: number) => Promise<SerializedGeneration | null>;
  /** Every action in flight, as `regen:${generationId}`. */
  actingOn: ReadonlySet<string>;
  /** The last failed regenerate per frame index. */
  frameErrors: Readonly<Record<number, string>>;
  /** Frame indexes whose job outlived the poll and may still deliver. */
  stillRunning: ReadonlySet<number>;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

async function startFrameJob(
  generationId: string,
  edits: FrameEdits | undefined,
): Promise<string> {
  const res = await fetch(
    `/api/design/generations/${encodeURIComponent(generationId)}/regenerate-frame`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(edits ? { edits } : {}),
    },
  );
  if (!res.ok) {
    throw new Error(await readError(res, "Regenerating didn't start."));
  }
  const { jobId } = (await res.json()) as { jobId: string };
  return jobId;
}

async function readRow(
  brandId: string,
  id: string,
): Promise<SerializedGeneration> {
  const res = await fetch(
    `/api/design/generations?brandId=${brandId}&ids=${encodeURIComponent(id)}`,
  );
  if (!res.ok) {
    throw new Error(await readError(res, "The new frame couldn't be loaded."));
  }
  const { generations } = (await res.json()) as {
    generations: SerializedGeneration[];
  };
  const row = generations.find((g) => g.id === id);
  if (row?.status !== "succeeded") {
    throw new Error("The new frame couldn't be loaded.");
  }
  return row;
}

function without<T>(items: ReadonlySet<T>, item: T): ReadonlySet<T> {
  const next = new Set(items);
  next.delete(item);
  return next;
}

/**
 * One set on screen and the frames being regenerated in it. Frames
 * regenerate independently: each is its own billed job, so two can run at
 * once and neither blocks the other.
 */
export function useFrameSet(): FrameSetState {
  const [set, setSet] = useState<DesignSet | null>(null);
  const [actingOn, setActingOn] = useState<ReadonlySet<string>>(new Set());
  const [frameErrors, setFrameErrors] = useState<Record<number, string>>({});
  const [stillRunning, setStillRunning] = useState<ReadonlySet<number>>(
    new Set(),
  );
  /* A regenerate that lands after the set it belongs to was closed or
     replaced must not write into the one now on screen. */
  const current = useRef<DesignSet | null>(null);
  /* The job each frame is waiting on, kept while it may still deliver so
     "Keep waiting" follows it instead of starting another. */
  const frameJobs = useRef(new Map<number, { jobId: string; key: string }>());
  /* The frames in `stillRunning`, readable from refresh. */
  const waiting = useRef(new Set<number>());

  const load = useCallback((next: DesignSet | null) => {
    current.current = next;
    frameJobs.current.clear();
    waiting.current.clear();
    setSet(next);
    setActingOn(new Set());
    setFrameErrors({});
    setStillRunning(new Set());
  }, []);

  const refresh = useCallback((next: DesignSet) => {
    const held = current.current;
    const merged = held ? mergeSets(held, next) : next;
    current.current = merged;
    setSet(merged);
    /* A frame this viewer stopped waiting on can land through the grid's
       watcher instead; once its new row is on show the wait is over. */
    const landed = [...waiting.current].filter(
      (index) =>
        held?.frames[index]?.generation?.id !==
        merged.frames[index]?.generation?.id,
    );
    if (landed.length === 0) return;
    for (const index of landed) {
      waiting.current.delete(index);
      frameJobs.current.delete(index);
    }
    setStillRunning((indexes) =>
      landed.reduce((acc, index) => without(acc, index), indexes),
    );
    setFrameErrors((errors) => {
      const nextErrors = { ...errors };
      for (const index of landed) delete nextErrors[index];
      return nextErrors;
    });
  }, []);

  const follow = useCallback(
    async (
      owner: DesignSet,
      index: number,
      jobId: string,
      key: string,
      hadFrame: boolean,
    ): Promise<SerializedGeneration | null> => {
      const stillOwner = () => current.current?.setId === owner.setId;
      setActingOn((keys) => new Set(keys).add(key));
      waiting.current.delete(index);
      setStillRunning((indexes) => without(indexes, index));
      setFrameErrors(({ [index]: _cleared, ...rest }) => rest);
      try {
        const result = await pollGenerationJob<RegenerateFrameJobResult>(jobId);
        forgetSetJob(jobId);
        frameJobs.current.delete(index);
        const row = await readRow(owner.brandId, result.generationId);
        if (!stillOwner()) return null;
        setSet((held) => {
          const next = held ? swapFrame(held, row) : held;
          current.current = next;
          return next;
        });
        return row;
      } catch (err) {
        const stopped = stoppedWaiting(err);
        if (!stopped) {
          forgetSetJob(jobId);
          frameJobs.current.delete(index);
        }
        if (!stillOwner()) return null;
        if (stopped) {
          waiting.current.add(index);
          setStillRunning((indexes) => new Set(indexes).add(index));
          setFrameErrors((errors) => ({
            ...errors,
            [index]: FRAME_STILL_RUNNING,
          }));
          return null;
        }
        const reason = err instanceof Error ? err.message : "";
        setFrameErrors((errors) => ({
          ...errors,
          [index]: hadFrame
            ? `Regenerating didn't work, so this frame is unchanged. ${reason}`.trim()
            : `Regenerating didn't work. ${reason}`.trim(),
        }));
        return null;
      } finally {
        if (stillOwner()) setActingOn((keys) => without(keys, key));
      }
    },
    [],
  );

  const regenerateFrame = useCallback(
    async (
      generationId: string,
      edits?: FrameEdits,
    ): Promise<SerializedGeneration | null> => {
      const owner = current.current;
      const slot = owner?.frames.find((f) => f.generation?.id === generationId);
      if (!owner || !slot) return null;
      /* A job already making this frame may still deliver: watch it, never
         bill a second one for the same frame. */
      if (frameJobs.current.has(slot.index)) return null;
      const key = regenKey(generationId);
      const hadFrame = slot.generation?.status === "succeeded";
      setActingOn((keys) => new Set(keys).add(key));
      setFrameErrors(({ [slot.index]: _cleared, ...rest }) => rest);
      let jobId: string;
      try {
        jobId = await startFrameJob(generationId, edits);
      } catch (err) {
        if (current.current?.setId === owner.setId) {
          setActingOn((keys) => without(keys, key));
          const reason = err instanceof Error ? err.message : "";
          setFrameErrors((errors) => ({
            ...errors,
            [slot.index]: hadFrame
              ? `Regenerating didn't work, so this frame is unchanged. ${reason}`.trim()
              : `Regenerating didn't work. ${reason}`.trim(),
          }));
        }
        return null;
      }
      frameJobs.current.set(slot.index, { jobId, key });
      rememberSetJob({
        jobId,
        brandId: owner.brandId,
        kind: "frame",
        sequenceKind: owner.kind,
        setId: owner.setId,
      });
      return follow(owner, slot.index, jobId, key, hadFrame);
    },
    [follow],
  );

  const keepWaiting = useCallback(
    async (index: number): Promise<SerializedGeneration | null> => {
      const owner = current.current;
      const job = frameJobs.current.get(index);
      if (!owner || !job) return null;
      const hadFrame = owner.frames[index]?.generation?.status === "succeeded";
      return follow(owner, index, job.jobId, job.key, hadFrame);
    },
    [follow],
  );

  return {
    set,
    load,
    refresh,
    regenerateFrame,
    keepWaiting,
    actingOn,
    frameErrors,
    stillRunning,
  };
}
