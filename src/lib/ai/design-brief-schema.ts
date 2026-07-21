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
