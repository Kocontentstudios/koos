import { z } from "zod";

// Calendar generation is split into two AI passes: a fast OUTLINE call that
// plans every posting slot (no briefs), then small parallel CHUNK calls that
// write the expensive structured-markdown briefs one segment (~week) at a
// time. The AI returns one startDate plus day OFFSETS (0-based) — the server
// validates the start (see resolveStartDate) and maps offsets onto concrete
// dates so hallucinated dates can't reach the calendar. 90-day hard cap.

/** One planned posting slot — everything about an item except its brief. */
export const calendarSlotSchema = z.object({
  dayOffset: z.number().int().min(0).max(89),
  time: z.string().min(1),
  platform: z.string().min(1),
  contentType: z.string().min(1),
  title: z.string().min(1),
  designRequired: z.boolean(),
  designType: z.string().optional(),
  dimensions: z.string().optional(),
});

export const calendarItemPlanSchema = calendarSlotSchema.extend({
  brief: z.string().min(1),
});

/** Output of the outline pass: the full slot plan, grouped into segments. */
export const calendarOutlineSchema = z.object({
  /** First calendar day (YYYY-MM-DD), derived from the strategy timeline. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  segments: z
    .array(
      z.object({
        /** Content theme guiding this segment's briefs. */
        theme: z.string().min(1),
        slots: z.array(calendarSlotSchema).min(1),
      }),
    )
    .min(1),
});

/**
 * Output of one chunk pass: a brief per slot, keyed by the slot's index in
 * the segment it was given. Slot fields are never echoed back — the outline
 * stays authoritative, so a chunk can't move or rename items.
 */
export const calendarChunkSchema = z.object({
  briefs: z
    .array(
      z.object({
        slotIndex: z.number().int().min(0),
        brief: z.string().min(1),
      }),
    )
    .min(1),
});

export const calendarPlanSchema = z.object({
  /** First calendar day (YYYY-MM-DD), derived from the strategy timeline. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(calendarItemPlanSchema).min(1),
});

export type CalendarSlot = z.infer<typeof calendarSlotSchema>;
export type CalendarOutline = z.infer<typeof calendarOutlineSchema>;
export type CalendarChunk = z.infer<typeof calendarChunkSchema>;
/** Server-assigned identity for a planned item, stable across the (date,
 * time) re-sort in toCalendarRows. Never comes from the model — it is how a
 * finished brief unit finds the rows it belongs to. */
export type CalendarItemPlan = z.infer<typeof calendarItemPlanSchema> & {
  slotKey: string;
};

/** Items carry the server-assigned slotKey, so the plan type cannot be a
 * plain z.infer of the schema — the schema describes only what the model
 * returns. */
export type CalendarPlan = Omit<z.infer<typeof calendarPlanSchema>, "items"> & {
  items: CalendarItemPlan[];
};
