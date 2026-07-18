import type {
  CalendarChunk,
  CalendarItemPlan,
  CalendarOutline,
  CalendarSlot,
} from "@/lib/ai/calendar-schema";

/**
 * Retry an AI call that can fail transiently (schema-validation misses,
 * provider hiccups the SDK didn't retry). Rethrows the last error.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
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
