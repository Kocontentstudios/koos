import type {
  CalendarChunk,
  CalendarItemPlan,
  CalendarOutline,
  CalendarSlot,
} from "@/lib/ai/calendar-schema";

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with jitter: ~2s, ~8s, ~32s… Bedrock throttling
    resolves in seconds, so an instant retry lands in the same throttle
    window and fails identically. */
function backoffMs(attempt: number): number {
  return 2000 * 4 ** attempt + Math.random() * 1000;
}

/**
 * Retry an AI call that can fail transiently (schema-validation misses,
 * provider throttling/hiccups the SDK didn't retry), backing off between
 * attempts. Rethrows the last error.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  { sleep = defaultSleep }: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(backoffMs(i - 1));
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Map over items with at most `limit` calls in flight, preserving input
 * order in the results. Rejects on the first item failure. Used to pace the
 * per-segment calendar calls so a 90-day plan (~13 segments) doesn't slam
 * the model provider with everything at once and trip throttling.
 *
 * When `shouldStop` returns true, workers finish their current item but
 * take no new ones — skipped slots stay `undefined` in the result. Callers
 * that stop early must handle the gaps (the calendar job pauses and resumes
 * from its checkpoint).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  { shouldStop }: { shouldStop?: () => boolean } = {},
): Promise<(R | undefined)[]> {
  const results = new Array<R | undefined>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        if (shouldStop?.()) return;
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/** Minimal executable brief for a slot whose chunk brief never arrived. */
export function fallbackBrief(slot: CalendarSlot): string {
  return [
    `**Title**\n${slot.title}`,
    `**Objective**\nExecute this ${slot.contentType} for ${slot.platform} as planned in the calendar.`,
    `**Call-to-Action (CTA)**\nAlign with the campaign's key message.`,
  ].join("\n\n");
}

/**
 * Combine the outline (authoritative slots) with the chunk results (briefs
 * keyed by slotIndex). Slot fields always come from the outline; a chunk can
 * only contribute briefs. Out-of-range slotIndexes are ignored and slots the
 * chunk missed get a fallback brief, so one wayward chunk can't sink the job.
 */
export function assembleCalendarItems(
  segments: CalendarOutline["segments"],
  chunks: (CalendarChunk | null)[],
): CalendarItemPlan[] {
  return segments.flatMap((segment, i) => {
    const briefBySlot = new Map<number, string>();
    for (const entry of chunks[i]?.briefs ?? []) {
      if (entry.slotIndex < segment.slots.length) {
        briefBySlot.set(entry.slotIndex, entry.brief);
      }
    }
    return segment.slots.map((slot, j) => ({
      ...slot,
      brief: briefBySlot.get(j) ?? fallbackBrief(slot),
    }));
  });
}
