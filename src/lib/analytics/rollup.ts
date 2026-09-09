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

/* ── Tooltip vocabulary (ADMIN-BUG-003) ───────────────────────────────────
   The old label read "9 in the week to July 25": it named no metric, and said
   "week" whatever the bucket actually was. Everything below is pure and takes
   the bucket as an argument, so rollup's fixed-NOW tests are untouched. */

/** What one bar covers, as a word. */
export function bucketLabel(bucketDays: number): string {
  if (bucketDays === 1) return "Day";
  if (bucketDays === 7) return "Week";
  return `${bucketDays} days`;
}

/**
 * Signed, for prose. The cards use arrows (formatPercentChange) because a
 * glanceable figure carries direction in the glyph as well as the colour; a
 * sentence reads better with a sign.
 */
export function formatSignedPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)}%`;
}

const TOOLTIP_DAY: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
};

/**
 * The days a bucket covers, inclusive.
 *
 * `end` is exclusive, so the last day IN the bucket is the day before it. The
 * year is printed once when both ends share it and on both when they do not,
 * so a bucket spanning New Year still reads unambiguously.
 */
export function describeBucketRange(bucket: Bucket): string {
  const lastDay = new Date(bucket.end.getTime() - DAY_MS);
  const startYear = bucket.start.getUTCFullYear();
  const endYear = lastDay.getUTCFullYear();
  const start = bucket.start.toLocaleDateString("en-US", TOOLTIP_DAY);
  const end = lastDay.toLocaleDateString("en-US", TOOLTIP_DAY);

  if (start === end && startYear === endYear) return `${start}, ${endYear}`;
  if (startYear === endYear) return `${start} to ${end}, ${endYear}`;
  return `${start}, ${startYear} to ${end}, ${endYear}`;
}

/**
 * The whole tooltip: metric, value, period and — only when there is one — the
 * change against the previous bucket.
 *
 * `change` omitted or null means there is nothing to compare against (the
 * first bucket, or a previous bucket of zero). The segment is then absent
 * rather than printed as "—%", which reads as a measured value of nothing.
 */
export function tooltipText({
  bucket,
  metric,
  bucketDays,
  change,
}: {
  bucket: Bucket;
  /** Singular noun. Pluralised here so callers never pre-pluralise. */
  metric: string;
  bucketDays: number;
  change?: number | null;
}): string {
  const noun = bucket.count === 1 ? metric : `${metric}s`;
  const head = `${bucket.count} ${noun} - ${bucketLabel(bucketDays)}: ${describeBucketRange(bucket)}`;
  return change === undefined || change === null
    ? head
    : `${head} - Change: ${formatSignedPercent(change)}`;
}
