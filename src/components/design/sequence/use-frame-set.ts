"use client";

import { useCallback, useRef, useState } from "react";
import type {
  FrameEdits,
  RegenerateFrameJobResult,
} from "@/lib/design/sequence/contract";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { pollGenerationJob } from "@/lib/generation/poll-job";
import { type DesignSet, swapFrame } from "./set-model";

/** The pending key of one frame's regenerate, keyed to the row it replaces
 *  so only that frame claims to be working. */
export function regenKey(generationId: string): string {
  return `regen:${generationId}`;
}

export interface FrameSetState {
  set: DesignSet | null;
  load: (set: DesignSet | null) => void;
  /** Resolves to the frame's new row, or null when it did not come back; the
   *  old frame stays on show either way until a new one exists. */
  regenerateFrame: (
    generationId: string,
    edits?: FrameEdits,
  ) => Promise<SerializedGeneration | null>;
  /** Every action in flight, as `regen:${generationId}`. */
  actingOn: ReadonlySet<string>;
  /** The last failed regenerate per frame index. */
  frameErrors: Readonly<Record<number, string>>;
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

/**
 * One set on screen and the frames being regenerated in it. Frames
 * regenerate independently: each is its own billed job, so two can run at
 * once and neither blocks the other.
 */
export function useFrameSet(): FrameSetState {
  const [set, setSet] = useState<DesignSet | null>(null);
  const [actingOn, setActingOn] = useState<ReadonlySet<string>>(new Set());
  const [frameErrors, setFrameErrors] = useState<Record<number, string>>({});
  /* A regenerate that lands after the set it belongs to was closed or
     replaced must not write into the one now on screen. */
  const current = useRef<DesignSet | null>(null);

  const load = useCallback((next: DesignSet | null) => {
    current.current = next;
    setSet(next);
    setActingOn(new Set());
    setFrameErrors({});
  }, []);

  const regenerateFrame = useCallback(
    async (
      generationId: string,
      edits?: FrameEdits,
    ): Promise<SerializedGeneration | null> => {
      const owner = current.current;
      const slot = owner?.frames.find((f) => f.generation?.id === generationId);
      if (!owner || !slot) return null;
      const key = regenKey(generationId);
      const stillOwner = () => current.current?.setId === owner.setId;
      setActingOn((keys) => new Set(keys).add(key));
      setFrameErrors(({ [slot.index]: _cleared, ...rest }) => rest);
      try {
        const jobId = await startFrameJob(generationId, edits);
        const result = await pollGenerationJob<RegenerateFrameJobResult>(jobId);
        const row = await readRow(owner.brandId, result.generationId);
        if (!stillOwner()) return null;
        setSet((held) => {
          const next = held ? swapFrame(held, row) : held;
          current.current = next;
          return next;
        });
        return row;
      } catch (err) {
        if (!stillOwner()) return null;
        const reason = err instanceof Error ? err.message : "";
        setFrameErrors((errors) => ({
          ...errors,
          [slot.index]:
            slot.generation?.status === "succeeded"
              ? `Regenerating didn't work, so this frame is unchanged. ${reason}`.trim()
              : `Regenerating didn't work. ${reason}`.trim(),
        }));
        return null;
      } finally {
        if (stillOwner()) {
          setActingOn((keys) => {
            const next = new Set(keys);
            next.delete(key);
            return next;
          });
        }
      }
    },
    [],
  );

  return { set, load, regenerateFrame, actingOn, frameErrors };
}
