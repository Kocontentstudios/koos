import { z } from "zod";

// The AI returns one startDate plus day OFFSETS (0-based) — the server
// validates the start (see resolveStartDate) and maps offsets onto concrete
// dates so hallucinated dates can't reach the calendar. 90-day hard cap.
export const calendarItemPlanSchema = z.object({
  dayOffset: z.number().int().min(0).max(89),
  time: z.string().min(1),
  platform: z.string().min(1),
  contentType: z.string().min(1),
  title: z.string().min(1),
  brief: z.string().min(1),
  designRequired: z.boolean(),
  designType: z.string().optional(),
  dimensions: z.string().optional(),
});

export const calendarPlanSchema = z.object({
  /** First calendar day (YYYY-MM-DD), derived from the strategy timeline. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(calendarItemPlanSchema).min(1),
});

export type CalendarItemPlan = z.infer<typeof calendarItemPlanSchema>;
export type CalendarPlan = z.infer<typeof calendarPlanSchema>;
