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
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface GenerationSummary {
  outlineMs: number;
  totalMs: number;
  /** Outline is serial and blocking, so this is the ceiling on what
   *  parallelising everything else could ever win back. */
  outlineShare: number;
  unitCount: number;
  slotCount: number;
  concurrency: number;
  /** How many full passes the concurrency limit produced. Raising the limit
   *  cannot help a run that is already one wave deep. */
  waves: number;
  unitMs: {
    p50: number | null;
    p95: number | null;
    min: number | null;
    max: number | null;
    total: number;
  };
  tokens: {
    input: number;
    output: number;
    /** Paid on every unit call, and dominated by whatever the prompt re-sends. */
    inputPerUnit: number;
  };
  logLine: string;
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
  outlineMs: number;
  totalMs: number;
  concurrency: number;
  units: UnitTiming[];
}): GenerationSummary {
  const { outlineMs, totalMs, concurrency, units } = args;
  const durations = units.map((u) => u.ms);
  const input = units.reduce((n, u) => n + (u.inputTokens ?? 0), 0);
  const output = units.reduce((n, u) => n + (u.outputTokens ?? 0), 0);

  const summary: Omit<GenerationSummary, "logLine"> = {
    outlineMs,
    totalMs,
    outlineShare: totalMs > 0 ? outlineMs / totalMs : 0,
    unitCount: units.length,
    slotCount: units.reduce((n, u) => n + u.slots, 0),
    concurrency,
    waves: concurrency > 0 ? Math.ceil(units.length / concurrency) : 0,
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
      inputPerUnit: units.length ? Math.round(input / units.length) : 0,
    },
  };

  return { ...summary, logLine: `calendar-timing ${JSON.stringify(summary)}` };
}
