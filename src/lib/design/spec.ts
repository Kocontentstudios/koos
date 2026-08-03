import { z } from "zod";
import { SUPPORTED_ASPECT_RATIOS } from "@/lib/ai/image/types";

/** Layout templates the composite renderer can draw. Adding a value here
 * requires a matching template in render/templates. */
export const DESIGN_LAYOUTS = [
  "hero-center",
  "split-left",
  "banner-bottom",
  "quote-card",
  "stat-highlight",
] as const;

export const LOGO_PLACEMENTS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "none",
] as const;

/** Deliberately permissive. Models routinely emit "#fff", "rgb(...)" or a
 * colour name; a strict hex regex here turns that into a schema-validation
 * retry loop instead of a design. resolvePalette() sanitises it downstream. */
const colorValue = z.string();

/** The single structured description of a design. Both render routes consume
 * it: the composite renderer draws it literally, the native models are asked
 * to reproduce it. Keeping one spec is what makes the two routes comparable. */
export const designSpecSchema = z.object({
  layout: z.enum(DESIGN_LAYOUTS),
  /** Kept short — long headlines wrap badly at social dimensions. */
  headline: z.string().min(1).max(70),
  subheadline: z.string().max(140).optional(),
  cta: z.string().max(32).optional(),
  bodyPoints: z.array(z.string().max(90)).max(3).optional(),
  palette: z.object({
    background: colorValue,
    foreground: colorValue,
    accent: colorValue,
  }),
  logoPlacement: z.enum(LOGO_PLACEMENTS),
  /** Scene description for the text-free background plate. Must never ask for
   * lettering — the composite renderer draws all copy itself. */
  backgroundPrompt: z.string().min(1),
  backgroundTreatment: z.enum([
    "photographic",
    "illustration",
    "gradient",
    "pattern",
    "solid",
  ]),
  /** Full-design instruction for a text-capable model (native route). */
  nativePrompt: z.string().min(1),
  aspectRatio: z.enum(SUPPORTED_ASPECT_RATIOS),
});

export type DesignSpec = z.infer<typeof designSpecSchema>;
