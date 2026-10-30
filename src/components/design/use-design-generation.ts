"use client";

import { useCallback, useRef, useState } from "react";
import {
  readSequenceProgress,
  type SequenceProgress,
} from "@/components/design/sequence/progress";
import {
  buildSet,
  type DesignSet,
  kindNoun,
  readyFrames,
} from "@/components/design/sequence/set-model";
import {
  type FrameSetState,
  useFrameSet,
} from "@/components/design/sequence/use-frame-set";
import type {
  SequenceJobResult,
  SequenceKind,
} from "@/lib/design/sequence/contract";
import type { SerializedGeneration } from "@/lib/design/serialize";
import {
  type JobStage,
  type JobStatusResponse,
  pollGenerationJob,
} from "@/lib/generation/poll-job";

export interface GenerateArgs {
  brandId: string;
  briefId?: string | null;
  calendarItemId?: string | null;
  attachments?: { type: string; id: string }[];
  freeform?: string | null;
  aspectRatio?: string | null;
  /** Required: without it the server takes the legacy variant path, which
   *  runs only while FEATURE_KO_IMAGERY is on. */
  image: DesignImageChoice;
  /** A generation id: the job makes exactly one new direction to take that
   *  one's place. Requires `image`. */
  regenerateOf?: string;
}

/** What the caller knows about the run that the request does not carry. */
export interface GenerateOptions {
  /** The kind the brief's design type names (sequenceKindOf). It names the
   *  wait ("Planning your carousel…") and gives the poll a set's length of
   *  time. The server still decides whether a set is built. */
  sequenceKind?: SequenceKind | null;
}

/** `none` is a text-led design with no image, the second choice while
 *  FEATURE_KO_IMAGERY is off. */
export type DesignImageChoice =
  | { source: "upload"; key: string }
  | { source: "ko" }
  | { source: "none" };

/**
 * Where a run is, coarser than the job's own label: "starting" until the
 * worker reports anything, "running" while it does, "fetching" once the job is
 * done and its rows are being read back.
 */
export type GenerationStage = "starting" | "running" | "fetching";

interface DirectionsJobResult {
  kind?: undefined;
  generationIds: string[];
  failed: string[];
}

type JobResult = DirectionsJobResult | SequenceJobResult;

/* A ten-frame KO-imagery set runs as several 210s slices with a resume
   between each, well past the five minutes a directions run is given. */
export const SET_POLL_TIMEOUT_MS = 20 * 60 * 1000;

export interface DesignGenerationState {
  /** Resolves to the designs that rendered; empty on failure or when a newer
   *  run superseded this one. */
  generate: (
    args: GenerateArgs,
    options?: GenerateOptions,
  ) => Promise<SerializedGeneration[]>;
  /** Re-reads a finished job's designs, keeps waiting on one still running,
   *  or re-runs one that produced none. */
  retry: () => Promise<void>;
  pending: boolean;
  progressLabel: string | null;
  stage: GenerationStage | null;
  /** The worker's own done/total, as last reported. */
  progress: { done: number; total: number } | null;
  /** The directions job's own stage, as last reported. Null until it reports
   *  one, and always null on the legacy path. */
  jobStage: JobStage | null;
  error: string | null;
  /** Set with `error` when the client stopped waiting but the job had not
   *  failed: `retry` goes back to watching it rather than starting another. */
  stillRunning: boolean;
  /** Set when some designs rendered and some did not. Never set with `error`. */
  partial: string | null;
  /** How many rows the job produced that did not render. */
  failedCount: number;
  /** Those rows' ids, so a failed direction can be regenerated in its slot. */
  failedIds: string[];
  /** Every rendered design, in order; for a set, its rendered frames. */
  generations: SerializedGeneration[];
  /** Set when the run made a carousel or presentation: every frame, in
   *  index order, rendered or not. Null for single designs. */
  set: DesignSet | null;
  /** Set while a sequence job reports where it is. */
  sequenceProgress: SequenceProgress | null;
  /** Replaces one frame of `set` in place; see useFrameSet. */
  regenerateFrame: FrameSetState["regenerateFrame"];
  /** `regen:${generationId}` for every frame regenerating. */
  frameActions: FrameSetState["actingOn"];
  frameErrors: FrameSetState["frameErrors"];
  reset: () => void;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "Design generation failed. Please try again.";
}

/* Asked once the poll has given up, to tell "stopped waiting" from "the job
   failed". Anything short of a definite failure counts as still running:
   starting another job for one that is in fact still going bills the user
   twice. */
async function jobMayStillDeliver(jobId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) return res.status >= 500;
    const { status } = (await res.json()) as JobStatusResponse<unknown>;
    return status !== "failed";
  } catch {
    return true;
  }
}

class StillRunningError extends Error {}

function stillRunningMessage(kind: SequenceKind | null): string {
  const what = kind ? `Your ${kindNoun(kind)} is` : "Your designs are";
  return `${what} still being made. It's taking longer than usual; it keeps going while you wait, and finished designs also appear in Design Studio.`;
}

interface LastRun {
  args: GenerateArgs;
  options: GenerateOptions;
  /** The job this run started. Kept until it is known to have failed, so a
   *  retry never posts a second job while the first may still deliver. */
  jobId: string | null;
  ids: string[];
  sequence: SequenceJobResult | null;
}

/** Drives the 202 + poll flow every entry point shares, then reloads the
 * finished variants so callers only deal with rendered designs. */
export function useDesignGeneration(): DesignGenerationState {
  const [pending, setPending] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [stage, setStage] = useState<GenerationStage | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [jobStage, setJobStage] = useState<JobStage | null>(null);
  const [sequenceProgress, setSequenceProgress] =
    useState<SequenceProgress | null>(null);
  const frameSet = useFrameSet();
  const loadSet = frameSet.load;
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stillRunning, setStillRunning] = useState(false);
  const [generations, setGenerations] = useState<SerializedGeneration[]>([]);
  /* Distinct from `error`: some designs rendered and are usable. An error
     would hide them, and a shorter list alone says nothing about what was
     expected. */
  const [partial, setPartial] = useState<string | null>(null);
  // Guards against a late poll from a superseded run overwriting fresh state.
  const runId = useRef(0);
  /* What the last job actually produced. A failure AFTER `ids` is set is a
     display failure: the designs exist, so retrying must re-read them rather
     than generate again and bill the user for duplicates. */
  const lastRun = useRef<LastRun | null>(null);

  const clearProgress = useCallback(() => {
    setProgressLabel(null);
    setStage(null);
    setProgress(null);
    setJobStage(null);
    setSequenceProgress(null);
  }, []);

  const reset = useCallback(() => {
    runId.current += 1;
    setPending(false);
    clearProgress();
    setError(null);
    setStillRunning(false);
    setPartial(null);
    setFailedIds([]);
    setGenerations([]);
    loadSet(null);
  }, [clearProgress, loadSet]);

  /* Reads exactly the rows a job produced and puts them on screen. Separate
     from `generate` so a retry after a DISPLAY failure can call it without
     starting another generation. */
  const loadByIds = useCallback(
    async (
      brandId: string,
      ids: string[],
      run: number,
    ): Promise<SerializedGeneration[]> => {
      const listRes = await fetch(
        `/api/design/generations?brandId=${brandId}&ids=${ids.join(",")}`,
      );
      if (!listRes.ok) throw new Error(await readError(listRes));
      const { generations: rows } = (await listRes.json()) as {
        generations: SerializedGeneration[];
      };
      if (runId.current !== run) return [];

      const succeeded = rows.filter((g) => g.status === "succeeded");
      /* The job produced rows and every one of them failed to render: a real
         failure, not an empty state. */
      if (succeeded.length === 0) {
        throw new Error(
          "That design could not be generated. Please try again.",
        );
      }

      setGenerations(succeeded);
      const rendered = new Set(succeeded.map((g) => g.id));
      setFailedIds(ids.filter((id) => !rendered.has(id)));
      /* Partial success is stated, not silently shown as a shorter list. The
         designs that DID render are kept — the user can still use them. */
      setPartial(
        succeeded.length < ids.length
          ? `${succeeded.length} of ${ids.length} designs came back. You can use these or try again for the rest.`
          : null,
      );
      return succeeded;
    },
    [],
  );

  /* A set is read back the same way, failed frames included: the viewer
     shows a frame that did not render in its place, with a retry, rather
     than a shorter carousel. */
  const loadSequence = useCallback(
    async (
      brandId: string,
      result: SequenceJobResult,
      run: number,
    ): Promise<SerializedGeneration[]> => {
      const ids = [...result.generationIds, ...result.failed];
      const listRes = await fetch(
        `/api/design/generations?brandId=${brandId}&ids=${ids.join(",")}`,
      );
      if (!listRes.ok) throw new Error(await readError(listRes));
      const { generations: rows } = (await listRes.json()) as {
        generations: SerializedGeneration[];
      };
      if (runId.current !== run) return [];

      const set = buildSet(brandId, rows, {
        setId: result.setId,
        kind: result.sequenceKind,
        frameCount: result.frameCount,
      });
      const rendered = set ? readyFrames(set) : [];
      if (!set || rendered.length === 0) {
        throw new Error(
          `That ${result.sequenceKind} could not be generated. Please try again.`,
        );
      }

      loadSet(set);
      setGenerations(rendered);
      const shown = new Set(rendered.map((g) => g.id));
      setFailedIds(ids.filter((id) => !shown.has(id)));
      setPartial(
        rendered.length < result.frameCount
          ? `${rendered.length} of ${result.frameCount} frames came back. Retry the missing ones from their place in the ${result.sequenceKind}.`
          : null,
      );
      return rendered;
    },
    [loadSet],
  );

  const readBack = useCallback(
    (
      brandId: string,
      ids: string[],
      sequence: SequenceJobResult | null,
      run: number,
    ) =>
      sequence
        ? loadSequence(brandId, sequence, run)
        : loadByIds(brandId, ids, run),
    [loadByIds, loadSequence],
  );

  /* Watches a started job to the end and reads back what it made. Shared by
     a fresh run and by a retry that goes back to a job still running. */
  const follow = useCallback(
    async (last: LastRun, jobId: string, run: number) => {
      const expectedKind = last.options.sequenceKind ?? null;
      let result: JobResult;
      try {
        result = await pollGenerationJob<JobResult>(jobId, {
          timeoutMs: expectedKind ? SET_POLL_TIMEOUT_MS : undefined,
          onProgress: (p) => {
            if (runId.current !== run) return;
            setProgressLabel(p.label);
            setStage("running");
            setProgress({ done: p.done, total: p.total });
            if (p.stage) setJobStage(p.stage);
            setSequenceProgress(readSequenceProgress(p, expectedKind));
          },
        });
      } catch (err) {
        if (await jobMayStillDeliver(jobId)) {
          throw new StillRunningError(stillRunningMessage(expectedKind));
        }
        last.jobId = null;
        throw err;
      }
      last.jobId = null;
      if (runId.current !== run) return [];

      /* Every generation this job produced failed, and there is nothing to
       show. Said as an error the user can act on rather than as an empty
       result, which reads as "nothing happened". */
      if (result.generationIds.length === 0) {
        throw new Error(
          `That ${result.kind === "sequence" ? result.sequenceKind : "design"} could not be generated. Please try again.`,
        );
      }

      /* BY ID, not "the newest N for this brand". The old request asked for
       the newest `generationIds.length` rows and then filtered that page
       down to this run's ids — so anything newer for the same brand pushed
       this run's rows out of the window, the filter emptied, and a
       successful generation rendered "No designs yet" while the designs sat
       in Design Studio. Addressing the rows removes the whole class. */
      last.ids = result.generationIds;
      last.sequence = result.kind === "sequence" ? result : null;
      setStage("fetching");
      setProgressLabel("Getting your designs ready…");
      return await readBack(last.args.brandId, last.ids, last.sequence, run);
    },
    [readBack],
  );

  const settle = useCallback((run: number, err: unknown) => {
    if (runId.current !== run) return;
    setStillRunning(err instanceof StillRunningError);
    setError(err instanceof Error ? err.message : "Design generation failed.");
  }, []);

  const begin = useCallback((label: string, stageNow: GenerationStage) => {
    setPending(true);
    setError(null);
    setStillRunning(false);
    setPartial(null);
    setFailedIds([]);
    setSequenceProgress(null);
    setProgressLabel(label);
    setStage(stageNow);
    setProgress(null);
    setJobStage(null);
  }, []);

  const finish = useCallback(
    (run: number) => {
      if (runId.current !== run) return;
      setPending(false);
      clearProgress();
    },
    [clearProgress],
  );

  const generate = useCallback(
    async (
      args: GenerateArgs,
      options: GenerateOptions = {},
    ): Promise<SerializedGeneration[]> => {
      const run = ++runId.current;
      /* Recorded before anything can fail, with no job yet: a failure before
       the POST returns means nothing was started, so a retry is a real
       re-run rather than a re-read. */
      const last: LastRun = {
        args,
        options,
        jobId: null,
        ids: [],
        sequence: null,
      };
      lastRun.current = last;
      begin("Starting…", "starting");
      setGenerations([]);
      loadSet(null);
      try {
        const res = await fetch("/api/design/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(args),
        });
        if (!res.ok) throw new Error(await readError(res));
        const { jobId } = (await res.json()) as { jobId: string };
        last.jobId = jobId;
        return await follow(last, jobId, run);
      } catch (err) {
        settle(run, err);
        return [];
      } finally {
        finish(run);
      }
    },
    [begin, finish, follow, loadSet, settle],
  );

  /**
   * What "Try again" does after a failure.
   *
   * If the job already produced designs, this re-READS them. Regenerating
   * would bill the user again and leave duplicate designs behind for a
   * failure that was only ever about display — the ticket's "no duplicate
   * designs are created when a user retries after a display-only failure".
   * A job the client stopped waiting on is watched again, for the same
   * reason. Only a generation that produced nothing is actually re-run.
   */
  const retry = useCallback(async () => {
    const last = lastRun.current;
    if (!last) return;
    if (last.ids.length === 0 && !last.jobId) {
      await generate(last.args, last.options);
      return;
    }
    const run = ++runId.current;
    try {
      if (last.ids.length === 0 && last.jobId) {
        begin("Still working…", "running");
        await follow(last, last.jobId, run);
      } else {
        begin("Fetching your designs…", "fetching");
        await readBack(last.args.brandId, last.ids, last.sequence, run);
      }
    } catch (err) {
      settle(run, err);
    } finally {
      finish(run);
    }
  }, [begin, finish, follow, generate, readBack, settle]);

  return {
    generate,
    retry,
    pending,
    progressLabel,
    stage,
    progress,
    jobStage,
    error,
    stillRunning,
    partial,
    failedCount: failedIds.length,
    failedIds,
    generations,
    set: frameSet.set,
    sequenceProgress,
    regenerateFrame: frameSet.regenerateFrame,
    frameActions: frameSet.actingOn,
    frameErrors: frameSet.frameErrors,
    reset,
  };
}
