"use client";

import { useCallback, useRef, useState } from "react";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { pollGenerationJob } from "@/lib/generation/poll-job";

export interface GenerateArgs {
  brandId: string;
  briefId?: string | null;
  calendarItemId?: string | null;
  attachments?: { type: string; id: string }[];
  freeform?: string | null;
  aspectRatio?: string | null;
}

interface JobResult {
  generationIds: string[];
  failed: string[];
}

export interface DesignGenerationState {
  generate: (args: GenerateArgs) => Promise<void>;
  pending: boolean;
  progressLabel: string | null;
  error: string | null;
  generations: SerializedGeneration[];
  reset: () => void;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "Design generation failed. Please try again.";
}

/** Drives the 202 + poll flow every entry point shares, then reloads the
 * finished variants so callers only deal with rendered designs. */
export function useDesignGeneration(): DesignGenerationState {
  const [pending, setPending] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generations, setGenerations] = useState<SerializedGeneration[]>([]);
  // Guards against a late poll from a superseded run overwriting fresh state.
  const runId = useRef(0);

  const reset = useCallback(() => {
    runId.current += 1;
    setPending(false);
    setProgressLabel(null);
    setError(null);
    setGenerations([]);
  }, []);

  const generate = useCallback(async (args: GenerateArgs) => {
    const run = ++runId.current;
    setPending(true);
    setError(null);
    setGenerations([]);
    setProgressLabel("Starting…");
    try {
      const res = await fetch("/api/design/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error(await readError(res));
      const { jobId } = (await res.json()) as { jobId: string };

      const result = await pollGenerationJob<JobResult>(jobId, {
        onProgress: (p) => {
          if (runId.current === run) setProgressLabel(p.label);
        },
      });
      if (runId.current !== run) return;

      const listRes = await fetch(
        `/api/design/generations?brandId=${args.brandId}&limit=${Math.max(result.generationIds.length, 1)}`,
      );
      if (!listRes.ok) throw new Error(await readError(listRes));
      const { generations: rows } = (await listRes.json()) as {
        generations: SerializedGeneration[];
      };
      if (runId.current !== run) return;
      setGenerations(
        rows.filter(
          (g) =>
            result.generationIds.includes(g.id) && g.status === "succeeded",
        ),
      );
    } catch (err) {
      if (runId.current !== run) return;
      setError(
        err instanceof Error ? err.message : "Design generation failed.",
      );
    } finally {
      if (runId.current === run) {
        setPending(false);
        setProgressLabel(null);
      }
    }
  }, []);

  return { generate, pending, progressLabel, error, generations, reset };
}
