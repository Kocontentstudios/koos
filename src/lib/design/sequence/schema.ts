import { z } from "zod";
import { DESIGN_LAYOUTS, LOGO_PLACEMENTS } from "@/lib/design/spec";
import { COPY_TARGETS, DRAFT_LIMITS } from "@/lib/jobs/directions/schema";

/**
 * What the planner's model calls answer with. Looser than the contract on
 * purpose, as directionDraftSchema is: a headline at 74 characters would
 * otherwise fail the whole set, and the fault check names it instead so the
 * fix call can ask for a rewrite.
 *
 * Every field is required, with "" or [] as the empty answer, as in
 * spec.ts: Bedrock compiles the schema into a decoding grammar and each
 * optional property becomes a union in it.
 *
 * Roles are not asked for. A frame's role is its position (hook first, cta
 * last), so it is assigned in code and the model cannot get it wrong.
 */

const t = COPY_TARGETS;

export const ANGLE_MAX = 200;

/**
 * What a listed point is about. Two points of one kind make one point to a
 * reader ("no preservatives" and "nothing artificial" are both what goes
 * in it), so code holds no two frames to one kind while another is left.
 */
export const POINT_KINDS = [
  "what-it-is",
  "what-goes-in",
  "how-it-is-made",
  "where-it-comes-from",
  "who-makes-it",
  "what-you-get",
  "how-it-works",
  "proof",
  "who-it-is-for",
  "belief",
  "price",
  "when-where",
  "limit",
] as const;
export type PointKind = (typeof POINT_KINDS)[number];
export const SCENE_MAX = 400;

export const arcFrameSchema = z.object({
  point: z
    .number()
    .int()
    .describe(
      "The number of the point this frame makes, from the numbered list; 0 on the last frame, whose job is the action.",
    ),
  title: z
    .string()
    .min(1)
    .max(DRAFT_LIMITS.title)
    .describe(
      `What this frame is about in 2 to ${t.title.words} words, at most ${t.title.chars} characters, e.g. "The price". No two frames share a title.`,
    ),
  layout: z.enum(DESIGN_LAYOUTS),
  showsImage: z.boolean(),
});

/** The arc: the shared brand frame, one listed point per frame, the
 *  hook's angle on its point and the unused points ranked best first. The
 *  model ranks and assigns; the hook's angle is the only claim it writes. */
export function arcResponseSchema(count: number) {
  return z.object({
    palette: z.object({
      background: z.string(),
      foreground: z.string(),
      accent: z.string(),
    }),
    logoPlacement: z.enum(LOGO_PLACEMENTS),
    logoFree: z.boolean(),
    logoFreeQuote: z.string(),
    backgroundTreatment: z.enum([
      "photographic",
      "illustration",
      "gradient",
      "pattern",
      "solid",
    ]),
    footerStyle: z.enum(["bar", "text", "none"]),
    hookAngle: z
      .string()
      .max(ANGLE_MAX)
      .describe(
        "The hook's claim: frame 1's point said as the one reason to see frame 2, in a plain sentence. Not the copy.",
      ),
    kinds: z
      .array(z.enum(POINT_KINDS))
      .max(60)
      .describe(
        "The kind of each numbered point, in the list's order: what the point is about.",
      ),
    sameAs: z
      .array(
        z.object({
          a: z.number().int(),
          b: z.number().int(),
        }),
      )
      .max(40)
      .describe(
        "Every pair of listed points, by number, that a reader would say make one point: the same subject or quality from two sides, a cause and its effect. [] when none.",
      ),
    frames: z.array(arcFrameSchema).min(count).max(count),
    spare: z
      .array(z.number().int())
      .max(40)
      .describe(
        "Every point no frame uses, by number, strongest first; [] when none is left.",
      ),
  });
}

export type ArcAnswer = z.infer<ReturnType<typeof arcResponseSchema>>;

const copyFields = {
  headline: z
    .string()
    .min(1)
    .max(DRAFT_LIMITS.headline)
    .describe(
      `At most ${t.headline.words} words and ${t.headline.chars} characters.`,
    ),
  subheadline: z
    .string()
    .max(DRAFT_LIMITS.subheadline)
    .describe(
      `At most ${t.subheadline.words} words and ${t.subheadline.chars} characters, a whole sentence. Empty string for none.`,
    ),
  footerLines: z
    .array(z.string().max(DRAFT_LIMITS.footerLine))
    .max(DRAFT_LIMITS.footerLines)
    .describe(
      `Each line at most ${t.footerLine.chars} characters; [] for none.`,
    ),
};

export const frameCopySchema = z.object({
  title: z
    .string()
    .max(DRAFT_LIMITS.title)
    .describe(
      `The frame's name on its card, written last: 2 to ${t.title.words} words naming what this frame's own copy says, a whole phrase.`,
    ),
  ...copyFields,
  backgroundPrompt: z
    .string()
    .max(SCENE_MAX)
    .describe("The image or ground for this frame. Never any lettering."),
});

export const hookVersionSchema = z.object({
  headline: copyFields.headline,
  subheadline: copyFields.subheadline,
});

/** The copy for every frame of the arc, the one button the last frame
 *  carries, and more openings on the hook's claim. A single top-level cta
 *  means no other frame can hold one (H3), whatever the model writes. */
export function copyResponseSchema(count: number) {
  return z.object({
    frames: z.array(frameCopySchema).min(count).max(count),
    cta: z
      .string()
      .max(DRAFT_LIMITS.cta)
      .describe(
        `The last frame's button: at most ${t.cta.words} words and ${t.cta.chars} characters.`,
      ),
    otherHooks: z
      .array(hookVersionSchema)
      .max(4)
      .describe("Frame 1 written two more ways, on the same claim."),
  });
}

export type CopyAnswer = z.infer<ReturnType<typeof copyResponseSchema>>;

export const frameRewriteSchema = z.object({
  frame: z.number().int().describe("The frame's number, as listed."),
  title: z.string().min(1).max(DRAFT_LIMITS.title),
  ...copyFields,
  cta: z
    .string()
    .max(DRAFT_LIMITS.cta)
    .describe("Only for the last frame; empty string on every other."),
});

export type FrameRewrite = z.infer<typeof frameRewriteSchema>;

export const rewriteResponseSchema = z.object({
  frames: z.array(frameRewriteSchema).min(1).max(40),
});

/** A second reader's look at the written set, before any fix: what code
 *  cannot see in words alone. Frame and point numbers are as listed. */
export const auditResponseSchema = z.object({
  repeats: z
    .array(
      z.object({
        frame: z.number().int(),
        sameAs: z.number().int(),
      }),
    )
    .max(20)
    .describe(
      "Each frame whose point an earlier frame already made, in any words: the same benefit or quality, or a cause and its effect. frame is the later one, sameAs the earlier. [] when none.",
    ),
  unsourced: z
    .array(
      z.object({
        frame: z.number().int(),
        text: z.string().max(120),
      }),
    )
    .max(20)
    .describe(
      "Each fact a frame adds that neither the brief nor the brand profile gives in any words, quoted in at most 8 of the frame's own words. [] when none.",
    ),
  freshSpares: z
    .array(z.number().int())
    .max(40)
    .describe(
      "The spare points, by number, that say something no frame says. [] when none.",
    ),
});

export type AuditAnswer = z.infer<typeof auditResponseSchema>;
