import { z } from "zod";
import { DESIGN_LAYOUTS, LOGO_PLACEMENTS } from "@/lib/design/spec";
import { COPY_TARGETS, DRAFT_LIMITS } from "@/lib/jobs/directions/schema";

/**
 * What the planner's model calls answer with. Looser than the contract on
 * purpose, as directionDraftSchema is: a headline at 74 characters would
 * otherwise fail the whole set, and validateSequence names it instead so the
 * repair pass can ask for a rewrite.
 *
 * Every field is required, with "" or [] as the empty answer, as in
 * spec.ts: Bedrock compiles the schema into a decoding grammar and each
 * optional property becomes a union in it.
 *
 * Roles are not asked for. A frame's role is its position (hook first, cta
 * last), so it is assigned in code and the model cannot get it wrong.
 */

const t = COPY_TARGETS;

export const POINT_MAX = 200;
export const SCENE_MAX = 400;
export const REVIEW_NOTE_MAX = 300;

/**
 * The kinds of point a frame can make. Asked for so that "different
 * points" is checkable in code (repeatedPoints): two frames of one kind are
 * one point made twice, which is what the eval's judge kept finding when
 * the outline was free text alone ("both frames sell the craft").
 */
export const FRAME_BEATS = [
  "promise",
  "benefit",
  "proof",
  "detail",
  "how-it-works",
  "audience",
  "price",
  "when-where",
  "scarcity",
  "action",
] as const;
export type FrameBeatKind = (typeof FRAME_BEATS)[number];

export const outlineFrameSchema = z.object({
  beat: z
    .enum(FRAME_BEATS)
    .describe("The kind of point this frame makes; no two frames share one."),
  title: z
    .string()
    .min(1)
    .max(DRAFT_LIMITS.title)
    .describe(
      `What this frame is about in 2 to ${t.title.words} words, at most ${t.title.chars} characters, e.g. "The price".`,
    ),
  point: z
    .string()
    .min(1)
    .max(POINT_MAX)
    .describe(
      "The one thing this frame tells the viewer, in a plain sentence. Not the copy.",
    ),
  facts: z
    .array(z.number().int())
    .max(12)
    .describe("The numbers of the brief facts this frame states; [] for none."),
  profilePoint: z
    .number()
    .int()
    .describe(
      "The number of the brand-profile point this frame makes, or 0 when its point comes from the brief.",
    ),
  layout: z.enum(DESIGN_LAYOUTS),
  showsImage: z.boolean(),
});

/** The arc: one shared brand frame and one point per frame. */
export function outlineResponseSchema(count: number) {
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
    frames: z.array(outlineFrameSchema).min(count).max(count),
  });
}

export type OutlineAnswer = z.infer<ReturnType<typeof outlineResponseSchema>>;

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
      `At most ${t.subheadline.words} words and ${t.subheadline.chars} characters. Empty string for none.`,
    ),
  footerLines: z
    .array(z.string().max(DRAFT_LIMITS.footerLine))
    .max(DRAFT_LIMITS.footerLines)
    .describe(
      `Each line at most ${t.footerLine.chars} characters; [] for none.`,
    ),
};

export const frameCopySchema = z.object({
  ...copyFields,
  backgroundPrompt: z
    .string()
    .max(SCENE_MAX)
    .describe("The image or ground for this frame. Never any lettering."),
});

/** The copy for every frame of the outline, and the one button the last
 *  frame carries. A single top-level cta means no other frame can hold
 *  one (H3), whatever the model writes. */
export function copyResponseSchema(count: number) {
  return z.object({
    frames: z.array(frameCopySchema).min(count).max(count),
    cta: z
      .string()
      .max(DRAFT_LIMITS.cta)
      .describe(
        `The last frame's button: at most ${t.cta.words} words and ${t.cta.chars} characters.`,
      ),
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
  frames: z.array(frameRewriteSchema).min(1).max(20),
});

/** The edit pass's answer: the editor's read of which frames repeat
 *  another or lack a point, then the versions it wrote. */
export const editResponseSchema = z.object({
  review: z
    .array(
      z.object({
        frame: z.number().int().describe("The failing frame's number."),
        fails: z
          .string()
          .max(REVIEW_NOTE_MAX)
          .describe("What it repeats (naming the other frame) or lacks."),
      }),
    )
    .max(20),
  frames: z.array(frameRewriteSchema).min(1).max(40),
});

export type EditAnswer = z.infer<typeof editResponseSchema>;
