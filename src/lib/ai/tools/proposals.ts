import { z } from "zod";

const brandFields = z.object({
  fields: z
    .object({
      name: z.string().optional(),
      overview: z.string().optional(),
      businessType: z.string().optional(),
      stage: z.string().optional(),
      targetAudience: z.string().optional(),
      offer: z.string().optional(),
      tone: z.string().optional(),
      primaryGoal: z.string().optional(),
      values: z.string().optional(),
      wordsLove: z.string().optional(),
      wordsAvoid: z.string().optional(),
      brandStyle: z.string().optional(),
      competitors: z.string().optional(),
      differentiators: z.string().optional(),
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      additionalNotes: z.string().optional(),
    })
    .refine((f) => Object.keys(f).length > 0, "At least one field required"),
});

const designTicket = z.object({
  designType: z.string().min(1),
  brief: z.string().min(1),
  dimensions: z.string().optional(),
  slides: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

const calendar = z.object({
  strategyId: z.string().uuid().optional(),
  startDate: z.string(),
  endDate: z.string(),
  cadence: z.string().optional(),
});

const strategy = z.object({
  name: z.string().min(1),
  seed: z.string().min(1),
});

export const ProposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("brand_fields"), summary: z.string(), data: brandFields }),
  z.object({ kind: z.literal("design_ticket"), summary: z.string(), data: designTicket }),
  z.object({ kind: z.literal("calendar"), summary: z.string(), data: calendar }),
  z.object({ kind: z.literal("strategy"), summary: z.string(), data: strategy }),
]);

export type Proposal = z.infer<typeof ProposalSchema>;
