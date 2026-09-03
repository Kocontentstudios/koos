import { z } from "zod";

/* Exported for the lockstep test: extraction.ts, this schema and the
   propose_brand_field_updates tool must carry identical keys, or a valid
   extraction is silently stripped when the built proposal is validated. */
export const brandFieldKeys = [
  "name",
  "overview",
  "businessType",
  "stage",
  "targetAudience",
  "offer",
  "tone",
  "primaryGoal",
  "values",
  "wordsLove",
  "wordsAvoid",
  "brandStyle",
  "competitors",
  "competitorStrengths",
  "differentiators",
  "primaryColor",
  "secondaryColor",
  "additionalColors",
  "platforms",
  "primaryPlatform",
  "postingFrequency",
  "websiteUrl",
  "additionalNotes",
] as const;

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
      competitorStrengths: z.string().optional(),
      differentiators: z.string().optional(),
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      // Comma-separated on the wire; parsed to text[] at the confirm boundary.
      additionalColors: z.string().optional(),
      platforms: z.string().optional(),
      primaryPlatform: z.string().optional(),
      postingFrequency: z.string().optional(),
      websiteUrl: z.string().optional(),
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
});

const strategy = z.object({
  name: z.string().min(1),
  seed: z.string().min(1),
});

export const ProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("brand_fields"),
    summary: z.string(),
    data: brandFields,
  }),
  z.object({
    kind: z.literal("design_ticket"),
    summary: z.string(),
    data: designTicket,
  }),
  z.object({
    kind: z.literal("calendar"),
    summary: z.string(),
    data: calendar,
  }),
  z.object({
    kind: z.literal("strategy"),
    summary: z.string(),
    data: strategy,
  }),
]);

export type Proposal = z.infer<typeof ProposalSchema>;
