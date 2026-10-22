/**
 * The direction columns as stored, readable without the job that writes them:
 * the serializer and the route read a row's rationale, the job writes it.
 */

/** What `design_generations.rationale` holds. `set` and `slot` pair a
 *  direction with its sibling so regenerating one can avoid both layouts. */
export interface StoredRationale {
  title: string;
  reasons: string[];
  set: string;
  slot: number;
}

export function storedRationale(
  direction: { title: string; rationale: string[] },
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
