/**
 * Timing for a calendar generation, shaped so a budget can be argued from it.
 *
 * Pure and clock-free: callers pass durations they measured. The existing logs
 * round to whole seconds and are prose, which is fine for spotting a stall and
 * useless for deciding whether prompt-trimming or concurrency is the lever.
 */

export interface UnitTiming {
  key: string;
  slots: number;
  /** The whole withRetry span: attempts plus backoff sleeps. Useless alone —
   *  read it with `attempts`, or a 300s outlier cannot be told apart from
   *  three 100s calls, which need opposite fixes. */
  ms: number;
  attempts: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface GenerationSummary {
  jobId: string;
  outcome: "complete" | "paused" | "failed";
  outlineMs: number;
  totalMs: number;
  /** Outline is serial and blocking, so this is the ceiling on what
   *  parallelising everything else could ever win back. */
  outlineShare: number;
  unitCount: number;
  slotCount: number;
  concurrency: number;
  /** Retried calls. A slow run with retries is a throttling story; a slow run
   *  without them is a decode story. There is deliberately no "waves" figure:
   *  mapWithConcurrency is a work-stealing pool, so units/concurrency counts
   *  passes that never happen. */
  retriedUnits: number;
  unitMs: {
    p50: number | null;
    p95: number | null;
    min: number | null;
    max: number | null;
    total: number;
  };
  tokens: {
    /** Units only. The outline is a single call an order of magnitude larger
     *  than any unit, so folding it in would hide both. */
    input: number;
    output: number;
    outlineInput: number;
    outlineOutput: number;
    /** null, not 0, when the provider reported no usage: "free" and "unknown"
     *  are different answers to a cost question. */
    inputPerUnit: number | null;
    unitsWithUsage: number;
  };
}

/**
 * Nearest-rank percentile. Deliberately not interpolated: these are wall-clock
 * samples of real calls, so every reported figure should be a duration some
 * call actually took.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export function summariseGeneration(args: {
  jobId: string;
  outcome: "complete" | "paused" | "failed";
  outlineMs: number;
  totalMs: number;
  concurrency: number;
  outlineTokens?: { input: number; output: number };
  units: UnitTiming[];
}): GenerationSummary {
  const { jobId, outcome, outlineMs, totalMs, concurrency, units } = args;
  const outlineTokens = args.outlineTokens ?? { input: 0, output: 0 };
  const durations = units.map((u) => u.ms);
  const input = units.reduce((n, u) => n + (u.inputTokens ?? 0), 0);
  const output = units.reduce((n, u) => n + (u.outputTokens ?? 0), 0);

  const withUsage = units.filter((u) => u.inputTokens !== undefined);

  return {
    jobId,
    outcome,
    outlineMs,
    totalMs,
    outlineShare: totalMs > 0 ? outlineMs / totalMs : 0,
    unitCount: units.length,
    slotCount: units.reduce((n, u) => n + u.slots, 0),
    concurrency,
    retriedUnits: units.filter((u) => u.attempts > 1).length,
    unitMs: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      min: durations.length ? Math.min(...durations) : null,
      max: durations.length ? Math.max(...durations) : null,
      total: durations.reduce((n, ms) => n + ms, 0),
    },
    tokens: {
      input,
      output,
      outlineInput: outlineTokens.input,
      outlineOutput: outlineTokens.output,
      inputPerUnit: withUsage.length
        ? Math.round(input / withUsage.length)
        : null,
      unitsWithUsage: withUsage.length,
    },
  };
}
