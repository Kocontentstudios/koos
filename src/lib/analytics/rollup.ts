/**
 * Pure shaping for the admin analytics dashboard. No database, no clock: every
 * function takes `now` as an argument so the same inputs always produce the
 * same output and the whole module is testable without a database.
 *
 * Periods are rolling windows anchored on `now`, not calendar weeks. Calendar
 * weeks force a week-start convention and a timezone, and get both wrong for
 * somebody; "the last 7 days" needs neither.
 */

const DAY_MS = 86_400_000;

export type Bucket = { start: Date; end: Date; count: number };

/**
 * Splits timestamps into consecutive rolling windows ending at `now`, oldest
 * first. Empty windows are present with a count of 0 — a chart that silently
 * drops quiet periods compresses its own x-axis and reads as steady activity.
 */
export function bucketByPeriod(
  timestamps: Date[],
  {
    now,
    periodDays,
    periods,
  }: { now: Date; periodDays: number; periods: number },
): Bucket[] {
  if (periods <= 0 || periodDays <= 0) return [];

  const span = periodDays * DAY_MS;
  const end = now.getTime();
  const earliest = end - periods * span;

  const buckets: Bucket[] = Array.from({ length: periods }, (_, i) => ({
    start: new Date(earliest + i * span),
    end: new Date(earliest + (i + 1) * span),
    count: 0,
  }));

  for (const timestamp of timestamps) {
    const t = timestamp.getTime();
    if (t < earliest || t > end) continue;
    // A timestamp exactly at `now` lands one past the last bucket.
    const index = Math.min(Math.floor((t - earliest) / span), periods - 1);
    buckets[index].count += 1;
  }

  return buckets;
}

/**
 * Null rather than Infinity when the previous period was empty. Going from 0
 * to 5 is not "+500%", it has no percentage, and rendering one is a lie that
 * looks authoritative.
 */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function formatPercentChange(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "↑" : "↓"}${Math.abs(rounded)}%`;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  const days = ms / DAY_MS;
  if (days >= 1) return `${days.toFixed(1)}d`;
  const hours = ms / 3_600_000;
  if (hours >= 1) return `${Math.round(hours)}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

/** Bar widths as percentages of the largest value, for CSS-only charts. */
export function toBarPercentages(counts: number[]): number[] {
  const max = Math.max(0, ...counts);
  if (max === 0) return counts.map(() => 0);
  return counts.map((c) => (c / max) * 100);
}
