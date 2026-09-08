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
  /** Re-reads a finished job's designs, or re-runs one that produced none. */
  retry: () => Promise<void>;
  pending: boolean;
  progressLabel: string | null;
  error: string | null;
  /** Set when some designs rendered and some did not. Never set with `error`. */
  partial: string | null;
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
  /* Distinct from `error`: some designs rendered and are usable. An error
     would hide them, and a shorter list alone says nothing about what was
     expected. */
  const [partial, setPartial] = useState<string | null>(null);
  // Guards against a late poll from a superseded run overwriting fresh state.
  const runId = useRef(0);
  /* What the last job actually produced. A failure AFTER this is set is a
     display failure: the designs exist, so retrying must re-read them rather
     than generate again and bill the user for duplicates. */
  const lastRun = useRef<{ args: GenerateArgs; ids: string[] } | null>(null);

  const reset = useCallback(() => {
    runId.current += 1;
    setPending(false);
    setProgressLabel(null);
    setError(null);
    setPartial(null);
    setGenerations([]);
  }, []);

  /* Reads exactly the rows a job produced and puts them on screen. Separate
     from `generate` so a retry after a DISPLAY failure can call it without
     starting another generation. */
  const loadByIds = useCallback(
    async (brandId: string, ids: string[], run: number) => {
      const listRes = await fetch(
        `/api/design/generations?brandId=${brandId}&ids=${ids.join(",")}`,
      );
      if (!listRes.ok) throw new Error(await readError(listRes));
      const { generations: rows } = (await listRes.json()) as {
        generations: SerializedGeneration[];
      };
      if (runId.current !== run) return;

      const succeeded = rows.filter((g) => g.status === "succeeded");
      /* The job produced rows and every one of them failed to render: a real
         failure, not an empty state. */
      if (succeeded.length === 0) {
        throw new Error(
          "That design could not be generated. Please try again.",
        );
      }

      setGenerations(succeeded);
      /* Partial success is stated, not silently shown as a shorter list. The
         designs that DID render are kept — the user can still use them. */
      setPartial(
        succeeded.length < ids.length
          ? `${succeeded.length} of ${ids.length} designs came back. You can use these or try again for the rest.`
          : null,
      );
    },
    [],
  );

  const generate = useCallback(async (args: GenerateArgs) => {
    const run = ++runId.current;
    /* Recorded before anything can fail, with no ids yet: a failure from here
       until the poll returns means nothing was produced, so a retry is a real
       re-run rather than a re-read. */
    lastRun.current = { args, ids: [] };
    setPending(true);
    setError(null);
    setPartial(null);
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

      /* Every generation this job produced failed, and there is nothing to
         show. Said as an error the user can act on rather than as an empty
         result, which reads as "nothing happened". */
      if (result.generationIds.length === 0) {
        throw new Error(
          "That design could not be generated. Please try again.",
        );
      }

      /* BY ID, not "the newest N for this brand". The old request asked for
         the newest `generationIds.length` rows and then filtered that page
         down to this run's ids — so anything newer for the same brand pushed
         this run's rows out of the window, the filter emptied, and a
         successful generation rendered "No designs yet" while the designs sat
         in Design Studio. Addressing the rows removes the whole class. */
      lastRun.current = { args, ids: result.generationIds };
      await loadByIds(args.brandId, result.generationIds, run);
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

  /**
   * What "Try again" does after a failure.
   *
   * If the job already produced designs, this re-READS them. Regenerating
   * would bill the user again and leave duplicate designs behind for a
   * failure that was only ever about display — the ticket's "no duplicate
   * designs are created when a user retries after a display-only failure".
   * Only a generation that produced nothing is actually re-run.
   */
  const retry = useCallback(async () => {
    const last = lastRun.current;
    if (!last) return;
    if (last.ids.length === 0) {
      await generate(last.args);
      return;
    }
    const run = ++runId.current;
    setPending(true);
    setError(null);
    setPartial(null);
    setProgressLabel("Fetching your designs…");
    try {
      await loadByIds(last.args.brandId, last.ids, run);
    } catch (err) {
      if (runId.current !== run) return;
      setError(
        err instanceof Error ? err.message : "Could not load those designs.",
      );
    } finally {
      if (runId.current === run) {
        setPending(false);
        setProgressLabel(null);
      }
    }
  }, [generate, loadByIds]);

  return {
    generate,
    retry,
    pending,
    progressLabel,
    error,
    partial,
    generations,
    reset,
  };
}
