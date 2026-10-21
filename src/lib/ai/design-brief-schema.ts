import { z } from "zod";
import { formatRules, resolveDesignFormat } from "@/lib/design/formats";

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

/**
 * Step 1 of brief generation: what is being asked for, settled before a word
 * of the brief is written (KOOS-AI-001).
 *
 * One call used to decide the deliverable AND write the brief against four
 * templates with an instruction to pick, so the structure was chosen by the
 * same pass that was already committing to prose. Separating them lets the
 * brief step be handed exactly one structure.
 *
 * Required fields with empty-value sentinels rather than optionals: a
 * generateObject schema compiles to a decoding grammar on Bedrock and every
 * optional property becomes a union in it.
 */
export const deliverableSchema = z.object({
  /** The label, ideally one of DESIGN_TYPE_OPTIONS. Stays free text because
   *  resolveDesignFormat maps it and a strict enum would reject both stored
   *  rows and labels the chat path invents. */
  designType: z.string().min(1),
  /** "WIDTHxHEIGHT", or empty when the request never stated one. */
  dimensions: z.string(),
  /** 0 for a single frame. */
  slides: z.number().int().min(0).max(10),
});

export type Deliverable = z.infer<typeof deliverableSchema>;

/** Step 2 writes prose only — the deliverable is already decided. */
export const designBriefContentSchema = z.object({
  title: z.string().min(1),
  briefMarkdown: z.string().min(1),
  notes: z.string(),
});

export type DesignBriefContent = z.infer<typeof designBriefContentSchema>;

/**
 * The two steps composed back into the shape the Design Brief Card and the
 * ticket submit already store.
 *
 * Deterministic on purpose: the sentinel-to-absent conversions and the canvas
 * default have one correct answer each, and the old prompt spent a sentence
 * asking a model to remember that Instagram posts are 1080x1350.
 */
const PIXEL_SIZE = /^\d{2,5}\s*[x\u00d7]\s*\d{2,5}$/i;

export function assembleDesignBrief(
  deliverable: Deliverable,
  content: DesignBriefContent,
): DesignBrief {
  /* The model's answer is used only when it is actually a pixel size. "A2",
     "roughly square" and "not sure" all parse as a stated value otherwise, and
     a free-text dimension silently overrides the format's own canvas — which
     is the one value here that was tested. */
  const stated = deliverable.dimensions.trim();
  const dimensions = PIXEL_SIZE.test(stated)
    ? stated.replace(/\s*[x×]\s*/i, "x")
    : formatRules(resolveDesignFormat(deliverable.designType))
        .defaultDimensions;
  const notes = content.notes.trim();

  /* Parsed, not merely typed. The two steps are validated against their own
     narrower schemas, so without this the composed brief — which is what the
     Design Brief Card renders and the ticket submit stores — is the one shape
     in the flow nothing checks. */
  return designBriefSchema.parse({
    title: content.title,
    designType: deliverable.designType,
    briefMarkdown: content.briefMarkdown,
    ...(dimensions ? { dimensions } : {}),
    ...(deliverable.slides >= 2 ? { slides: deliverable.slides } : {}),
    ...(notes ? { notes } : {}),
  });
}

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
