import { z } from "zod";
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

/** What `design_generations.rationale` holds. `set` and `slot` pair a
 *  direction with its sibling so regenerating one can avoid both layouts. */
export interface StoredRationale {
  title: string;
  reasons: string[];
  set: string;
  slot: number;
}

export function storedRationale(
  direction: Pick<DirectionSpec, "title" | "rationale">,
  set: string,
  slot: number,
): StoredRationale {
  return { title: direction.title, reasons: direction.rationale, set, slot };
}

/** A rationale column read back, or null for a row that is not a direction. */
export function readRationale(value: unknown): StoredRationale | null {
  if (!value || typeof value !== "object") return null;
  const { title, reasons, set, slot } = value as Record<string, unknown>;
  if (typeof title !== "string" || !Array.isArray(reasons)) return null;
  return {
    title,
    reasons: reasons.filter((r): r is string => typeof r === "string"),
    set: typeof set === "string" ? set : "",
    slot: typeof slot === "number" ? slot : 0,
  };
}

/** The spec without the direction fields, as the spec column stores it. */
export function designSpecOf(direction: DirectionSpec): DesignSpec {
  const { title: _title, rationale: _rationale, ...spec } = direction;
  return spec;
}
