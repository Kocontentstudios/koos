"use client";

import { useCallback, useRef, useState } from "react";
import {
  plannedProgress,
  readSequenceProgress,
  type SequenceProgress,
} from "@/components/design/sequence/progress";
import {
  forgetSetJob,
  rememberSetJob,
} from "@/components/design/sequence/set-jobs";
import {
  buildSet,
  type DesignSet,
  kindNoun,
  leftOutOf,
  readyFrames,
} from "@/components/design/sequence/set-model";
import {
  type FrameSetState,
  useFrameSet,
} from "@/components/design/sequence/use-frame-set";
import type {
  ApprovedOutline,
  OutlineProblem,
  SequenceJobResult,
  SequenceKind,
} from "@/lib/design/sequence/contract";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { PollTimeoutError, stoppedWaiting } from "@/lib/generation/poll-errors";
import { type JobStage, pollGenerationJob } from "@/lib/generation/poll-job";

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
  /** The outline the user approved for a carousel or presentation; the
   *  server re-validates it and writes the set's copy from it. */
  approvedOutline?: ApprovedOutline;
}

/** What the caller knows about the run that the request does not carry. */
export interface GenerateOptions {
  /** Set only when FEATURE_MULTI_FRAME is on and the brief's design type
   *  names a carousel or presentation (sequenceKindOf): the server then
   *  builds a set, so the wait opens as one. */
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
  /** Re-reads a finished job's designs, keeps waiting on a set still
   *  running, or re-runs one that produced none. */
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
  /** Set when some designs rendered and some did not. Never set with `error`. */
  partial: string | null;
  /** How many rows the job produced that did not render. */
  failedCount: number;
  /** Those rows' ids, so a failed direction can be regenerated in its slot. */
  failedIds: string[];
  /** Every rendered design, in order; for a set, its rendered frames. */
  generations: SerializedGeneration[];
  reset: () => void;
  /* The fields below are KOOS-AI-002's. Optional so a caller written for
     single designs (and its test doubles) is still a whole state; the hook
     always returns them. */
  /** Set with `error` when the client stopped waiting on a SET whose job had
   *  not failed: `retry` goes back to watching it rather than starting
   *  another. A directions run never sets it. */
  stillRunning?: boolean;
  /** Set when the run made a carousel or presentation: every frame, in
   *  index order, rendered or not. Null for single designs. */
  set?: DesignSet | null;
  /** Set while a set's job runs, from the moment it is known to be one. */
  sequenceProgress?: SequenceProgress | null;
  /** Replaces one frame of `set` in place; see useFrameSet. */
  regenerateFrame?: FrameSetState["regenerateFrame"];
  keepWaitingOnFrame?: FrameSetState["keepWaiting"];
  /** `regen:${generationId}` for every frame regenerating. */
  frameActions?: FrameSetState["actingOn"];
  frameErrors?: FrameSetState["frameErrors"];
  framesStillRunning?: FrameSetState["stillRunning"];
  /** True while the generate request itself is in flight, before the
   *  server has accepted (or refused) the run. */
  posting?: boolean;
}

/** What the hook itself returns: every field, the set ones included. */
export type LiveDesignGeneration = Required<DesignGenerationState>;

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    problems?: OutlineProblem[];
  };
  /* "Invalid outline" alone gives the user nothing to fix; the first
     problem names the slide and the rule. */
  const problem = Array.isArray(body.problems) ? body.problems[0] : null;
  if (body.error && problem?.detail) {
    const where = problem.point == null ? "" : `Slide ${problem.point + 1}: `;
    return `${body.error}. ${where}${problem.detail}`;
  }
  return body.error ?? "Design generation failed. Please try again.";
}

class StillRunningError extends Error {}

function stillRunningMessage(kind: SequenceKind | null): string {
  const what = kind ? `Your ${kindNoun(kind)} is` : "Your slides are";
  return `${what} still being made. It's taking longer than usual and keeps going while you wait. You can close this: Design Studio picks it up and shows each frame as it lands.`;
}

interface LastRun {
  args: GenerateArgs;
  options: GenerateOptions;
  /** The job a set run started. Kept while it may still deliver, so a retry
   *  never posts a second job while the first is still going. */
  jobId: string | null;
  ids: string[];
  sequence: SequenceJobResult | null;
  /** Known to be building a set: from the caller's kind, or from the first
   *  progress report only a set sends. */
  isSet: boolean;
  /** The set's progress as last reported, so the wait reopens where it was. */
  progress: SequenceProgress | null;
}

/** Drives the 202 + poll flow every entry point shares, then reloads the
 * finished variants so callers only deal with rendered designs. */
export function useDesignGeneration(): LiveDesignGeneration {
  const [pending, setPending] = useState(false);
  const [posting, setPosting] = useState(false);
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
    setPosting(false);
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
        leftOut: leftOutOf(result),
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
     a fresh run and by a retry that goes back to a set still running. A
     directions run polls exactly as it always has: one poll, and any way it
     ends is that run's error. */
  const follow = useCallback(
    async (last: LastRun, jobId: string, run: number) => {
      const expectedKind = last.options.sequenceKind ?? null;
      const startedAt = Date.now();
      const watchAsSet = () => {
        if (last.isSet) return;
        last.isSet = true;
        /* Kept for Design Studio, which polls it on (and so resumes it) if
           this wait is closed or gives up. */
        const sequenceKind = last.progress?.kind ?? expectedKind;
        rememberSetJob({
          jobId,
          brandId: last.args.brandId,
          kind: "set",
          ...(sequenceKind ? { sequenceKind } : {}),
        });
      };
      if (expectedKind) watchAsSet();
      /* Only while this wait still shows the run. Once it was closed or
         replaced, Design Studio's watcher collects the end itself, and
         adds the set it made to the grid. */
      const settled = () => {
        if (last.isSet && runId.current === run) forgetSetJob(jobId);
      };

      let result: JobResult;
      for (;;) {
        const polledAsSet = last.isSet;
        try {
          result = await pollGenerationJob<JobResult>(jobId, {
            ...(polledAsSet
              ? {
                  timeoutMs: Math.max(
                    0,
                    SET_POLL_TIMEOUT_MS - (Date.now() - startedAt),
                  ),
                }
              : {}),
            onProgress: (p) => {
              if (runId.current !== run) return;
              setProgressLabel(p.label);
              setStage("running");
              setProgress({ done: p.done, total: p.total });
              if (p.stage) setJobStage(p.stage);
              const read = readSequenceProgress(p, expectedKind);
              if (read) {
                last.progress = read;
                watchAsSet();
              }
              setSequenceProgress(last.isSet ? last.progress : null);
            },
          });
          break;
        } catch (err) {
          /* It showed itself to be a set only after this poll began, so the
             poll still had a directions run's five minutes. */
          if (err instanceof PollTimeoutError && last.isSet && !polledAsSet) {
            continue;
          }
          if (last.isSet && stoppedWaiting(err)) {
            throw new StillRunningError(
              stillRunningMessage(last.progress?.kind ?? expectedKind),
            );
          }
          settled();
          last.jobId = null;
          throw err;
        }
      }
      settled();
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

  const begin = useCallback(
    (
      label: string,
      stageNow: GenerationStage,
      setProgressNow: SequenceProgress | null,
    ) => {
      setPending(true);
      setError(null);
      setStillRunning(false);
      setPartial(null);
      setFailedIds([]);
      setSequenceProgress(setProgressNow);
      setProgressLabel(label);
      setStage(stageNow);
      setProgress(null);
      setJobStage(null);
    },
    [],
  );

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
      /* A known set opens on its own wait, not the directions one, before
         the job's first report arrives. */
      const seeded = options.sequenceKind
        ? plannedProgress(
            options.sequenceKind,
            args.approvedOutline?.points.length ?? null,
          )
        : null;
      /* Recorded before anything can fail, with no job yet: a failure before
       the POST returns means nothing was started, so a retry is a real
       re-run rather than a re-read. */
      const last: LastRun = {
        args,
        options,
        jobId: null,
        ids: [],
        sequence: null,
        isSet: false,
        progress: seeded,
      };
      lastRun.current = last;
      begin("Starting…", "starting", seeded);
      setGenerations([]);
      loadSet(null);
      setPosting(true);
      const posted = () => {
        if (runId.current === run) setPosting(false);
      };
      try {
        const res = await fetch("/api/design/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(args),
        });
        if (!res.ok) throw new Error(await readError(res));
        const { jobId } = (await res.json()) as { jobId: string };
        last.jobId = jobId;
        posted();
        return await follow(last, jobId, run);
      } catch (err) {
        settle(run, err);
        return [];
      } finally {
        posted();
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
   * A set the client stopped waiting on is watched again, for the same
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
        begin("Still working…", "running", last.progress);
        await follow(last, last.jobId, run);
      } else {
        begin("Fetching your designs…", "fetching", null);
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
    keepWaitingOnFrame: frameSet.keepWaiting,
    frameActions: frameSet.actingOn,
    frameErrors: frameSet.frameErrors,
    framesStillRunning: frameSet.stillRunning,
    posting,
    reset,
  };
}
