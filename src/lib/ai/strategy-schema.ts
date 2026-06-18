import { z } from "zod";

export const strategySchema = z.object({
  campaignName: z.string().min(1),
  objective: z.string().min(1),
  targetAudience: z.string().min(1),
  keyMessage: z.string().min(1),
  channels: z
    .array(z.object({ name: z.string().min(1), rationale: z.string() }))
    .min(1),
  contentMix: z
    .array(
      z.object({
        type: z.string().min(1),
        count: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  timeline: z
    .array(
      z.object({
        phase: z.string().min(1),
        dateRange: z.string(),
        focus: z.string(),
      }),
    )
    .min(1),
  themes: z
    .array(z.object({ title: z.string().min(1), description: z.string() }))
    .min(1),
  postingSchedule: z
    .array(z.object({ channel: z.string().min(1), cadence: z.string() }))
    .min(1),
});

export type Strategy = z.infer<typeof strategySchema>;
