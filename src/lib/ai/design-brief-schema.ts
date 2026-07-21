import { z } from "zod";

/** Structured design brief the AI produces from a design-request conversation. */
export const designBriefSchema = z.object({
  /** Short request title, e.g. "Summer Sale Instagram Carousel". */
  title: z.string().min(1),
  /** Design type label, ideally one of the standard options (with dimensions). */
  designType: z.string().min(1),
  /** Pixel dimensions, e.g. "1080x1350". */
  dimensions: z.string().optional(),
  /** Carousel slide count when the format is a carousel. */
  slides: z.number().int().min(2).max(10).optional(),
  /** The full brief as structured markdown (per-format section template). */
  briefMarkdown: z.string().min(1),
  /** Extra notes for the designer (references, style, things to avoid). */
  notes: z.string().optional(),
});

export type DesignBrief = z.infer<typeof designBriefSchema>;

/** User edits to a persisted brief (Design Brief Card). Any subset of the
 * user-editable fields; null clears an optional field; required fields can
 * be changed but never emptied. ticketId is server-managed, so `strict`
 * rejects it (and any other stray key) instead of silently dropping it. */
export const designBriefUpdateSchema = z
  .object({
    title: z.string().min(1),
    designType: z.string().min(1),
    dimensions: z.string().nullable(),
    slides: z.number().int().min(2).max(10).nullable(),
    briefMarkdown: z.string().min(1),
    notes: z.string().nullable(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "No fields to update",
  });

export type DesignBriefUpdate = z.infer<typeof designBriefUpdateSchema>;
