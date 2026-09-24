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
  /** The brief explicitly asked for a design with no logo on it.
   *
   * Read by the model rather than matched in code. Whether a sentence asks for
   * the mark to be REMOVED is a question about negation scope in English, and
   * a regex gets it backwards: "never omit the logo" and "do not remove the
   * logo" both contain a removal verb next to the word logo. This is the one
   * genuinely latent half of the placement decision, so it is asked for
   * explicitly instead of inferred. */
  logoFree: z.boolean(),
  /** The words in the brief that asked for no logo, quoted exactly.
   *
   * Empty string when logoFree is false. A required string with an empty
   * sentinel rather than an optional field: generateObject compiles the schema
   * to a decoding grammar and optional properties are capped.
   *
   * This is what makes logoFree checkable. The flag alone is a boolean the
   * model can simply get wrong, with the same blast radius that made "none" a
   * bug — and a guard that only asks whether the brief MENTIONS a logo passes
   * every brief that discusses one, which is exactly where a wrong answer is
   * likeliest. A verbatim quotation cannot be invented: either those words are
   * in the brief or they are not. */
  logoFreeQuote: z.string(),
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
