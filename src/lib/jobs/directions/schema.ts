import { z } from "zod";
import { readRationale } from "@/lib/design/direction-rationale";
import { type DesignSpec, designSpecSchema } from "@/lib/design/spec";

/**
 * A direction is a DesignSpec plus the name the results card shows and its
 * "why this works" list (spec, "Client/server contract").
 */

export const DIRECTION_TITLE_MAX = 40;
export const DIRECTION_REASON_MAX = 90;
export const DIRECTION_REASONS_MIN = 2;
export const DIRECTION_REASONS_MAX = 4;

/** The hard limits every delivered direction meets: the DesignSpec's own
 *  copy limits plus the direction fields. */
export const COPY_LIMITS = {
  title: DIRECTION_TITLE_MAX,
  headline: 70,
  subheadline: 140,
  cta: 32,
  footerLine: 60,
  reason: DIRECTION_REASON_MAX,
} as const;

/** What the prompt asks for, well inside the hard limits, so a model that
 *  overshoots its target by a few words still lands inside the contract. */
export const COPY_TARGETS = {
  title: { words: 4, chars: 32 },
  headline: { words: 7, chars: 50 },
  subheadline: { words: 16, chars: 100 },
  cta: { words: 4, chars: 24 },
  footerLine: { words: 6, chars: 40 },
  reason: { words: 12, chars: 75 },
} as const;

/* Parse limits, far past the contract. An answer over these is not a long
   sentence but a broken one; repair.ts trims to them so the answer parses,
   and the fit pass in brief.ts then rewrites anything over the contract. */
export const DRAFT_LIMITS = {
  title: 120,
  headline: 200,
  subheadline: 300,
  cta: 100,
  footerLine: 150,
  footerLines: 3,
  reason: 300,
  reasons: 6,
  productName: 120,
  productLook: 400,
} as const;

const directionFields = {
  /** Empty when the model's name for it could not be kept (finalize.ts). */
  title: z.string().max(DIRECTION_TITLE_MAX),
  rationale: z
    .array(z.string().min(1).max(DIRECTION_REASON_MAX))
    .min(DIRECTION_REASONS_MIN)
    .max(DIRECTION_REASONS_MAX),
  /** The product the brief names, in its words, or "" when it names none.
   *  The plate check asks whether the painted image shows it. */
  productName: z.string().max(DRAFT_LIMITS.productName),
  /** What that product looks like, concretely, for the plate prompt. */
  productLook: z.string().max(DRAFT_LIMITS.productLook),
};

/** The contract every stored direction satisfies. */
export const directionSpecSchema = designSpecSchema.extend(directionFields);

export type DirectionSpec = z.infer<typeof directionSpecSchema>;

/* What the model is held to is looser than the contract on purpose. One
   reason at 94 characters would otherwise fail the whole object, and the user
   would get "The AI returned an unusable response" instead of two designs.
   The prompt asks for the targets above; brief.ts asks the model once to
   rewrite anything over the contract, and finalize.ts settles what is left
   without ever cutting a clause in half. The eval measures how often the
   model met the contract unaided. */
export const directionDraftSchema = designSpecSchema.extend({
  headline: z
    .string()
    .min(1)
    .max(DRAFT_LIMITS.headline)
    .describe(
      `At most ${COPY_TARGETS.headline.words} words and ${COPY_TARGETS.headline.chars} characters.`,
    ),
  subheadline: z
    .string()
    .max(DRAFT_LIMITS.subheadline)
    .optional()
    .describe(
      `At most ${COPY_TARGETS.subheadline.words} words and ${COPY_TARGETS.subheadline.chars} characters.`,
    ),
  cta: z
    .string()
    .max(DRAFT_LIMITS.cta)
    .optional()
    .describe(
      `At most ${COPY_TARGETS.cta.words} words and ${COPY_TARGETS.cta.chars} characters.`,
    ),
  footerLines: z
    .array(z.string().max(DRAFT_LIMITS.footerLine))
    .max(DRAFT_LIMITS.footerLines)
    .default([])
    .describe(`Each line at most ${COPY_TARGETS.footerLine.chars} characters.`),
  title: z
    .string()
    .min(1)
    .max(DRAFT_LIMITS.title)
    .describe(
      `The direction's name, 2 to ${COPY_TARGETS.title.words} words and at most ${COPY_TARGETS.title.chars} characters, e.g. "Playful product story".`,
    ),
  rationale: z
    .array(z.string().min(1).max(DRAFT_LIMITS.reason))
    .min(1)
    .max(DRAFT_LIMITS.reasons)
    .describe(
      `${DIRECTION_REASONS_MIN} to ${DIRECTION_REASONS_MAX} reasons, each one sentence of at most ${COPY_TARGETS.reason.words} words and ${COPY_TARGETS.reason.chars} characters.`,
    ),
  /* Defaulted so a model that leaves the product out still produces a
     design: the plate is then simply not checked for one. */
  productName: z
    .string()
    .max(DRAFT_LIMITS.productName)
    .default("")
    .describe(
      'The product the brief names, copied from the brief, e.g. "almond croissant". Empty string when the brief names no physical product.',
    ),
  productLook: z
    .string()
    .max(DRAFT_LIMITS.productLook)
    .default("")
    .describe(
      "What that product looks like, concretely enough that a painter who has never seen one draws the right thing: shape, layers, colours, garnish, how it is served. Empty string when productName is empty.",
    ),
});

export type DirectionDraft = z.infer<typeof directionDraftSchema>;

export function directionsResponseSchema(count: number) {
  return z.object({
    directions: z.array(directionDraftSchema).min(count).max(count),
  });
}

/** The spec without the direction fields, as the spec column stores it. */
export function designSpecOf(direction: DirectionSpec): DesignSpec {
  const {
    title: _title,
    rationale: _rationale,
    productName: _productName,
    productLook: _productLook,
    ...spec
  } = direction;
  return spec;
}

/** The fields of a set row that decide which direction is on screen. */
export interface SetRow {
  id: string;
  status: string;
  rationale: unknown;
  createdAt: Date;
}

/**
 * The direction shown beside `of`: the newest succeeded row in the set's
 * other slot. The UI swaps a regenerated row into its slot, so the newest row
 * per slot is what the user sees; recency across slots is not, because
 * regenerating one slot twice leaves its older row newer than the sibling.
 */
export function currentSibling<T extends SetRow>(
  rows: readonly T[],
  of: { id: string; set: string; slot: number },
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.id === of.id || row.status !== "succeeded") continue;
    const stored = readRationale(row.rationale);
    if (!stored || stored.set !== of.set || stored.slot === of.slot) continue;
    if (!best || row.createdAt > best.createdAt) best = row;
  }
  return best;
}
