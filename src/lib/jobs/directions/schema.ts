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

/** The contract every stored direction satisfies. */
export const directionSpecSchema = designSpecSchema.extend({
  title: z.string().min(1).max(DIRECTION_TITLE_MAX),
  rationale: z
    .array(z.string().min(1).max(DIRECTION_REASON_MAX))
    .min(DIRECTION_REASONS_MIN)
    .max(DIRECTION_REASONS_MAX),
});

export type DirectionSpec = z.infer<typeof directionSpecSchema>;

/* What the model is held to is looser than the contract on purpose. One
   reason at 94 characters would otherwise fail the whole object, and the user
   would get "The AI returned an unusable response" instead of two designs.
   finalizeDirection brings every draft inside the contract deterministically,
   and the eval measures how often the model met it unaided. */
export const directionDraftSchema = designSpecSchema.extend({
  title: z
    .string()
    .min(1)
    .max(80)
    .describe(
      `The direction's name, 2 to 5 words and at most ${DIRECTION_TITLE_MAX} characters, e.g. "Playful product story".`,
    ),
  rationale: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(6)
    .describe(
      `${DIRECTION_REASONS_MIN} to ${DIRECTION_REASONS_MAX} reasons this design works, each at most ${DIRECTION_REASON_MAX} characters.`,
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
  const { title: _title, rationale: _rationale, ...spec } = direction;
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
