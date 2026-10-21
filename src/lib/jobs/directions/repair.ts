import { clampText } from "./finalize";

/**
 * Rescues a directions answer that is complete but malformed, so the user
 * gets their designs instead of "The AI returned an unusable response".
 *
 * The AI SDK calls this only after the answer failed to parse or validate.
 * Two shapes are rescued:
 *
 *  - `directions` arrives as a JSON string holding the array, measured on
 *    the real model in 1 of 4 calls on the Eid fixture, or arrives bare.
 *  - a text field overshoots a hard DesignSpec limit. The model writes these
 *    lengths by feel, and two specs per call doubles the single-spec route's
 *    exposure to one overshoot failing everything.
 *
 * Text fields are shortened at a word boundary to the schema's own limits.
 * Anything else (a missing field, a wrong enum) is left to fail, because
 * inventing a value is worse than asking again.
 */

const LIMITS = {
  headline: 70,
  subheadline: 140,
  cta: 32,
  title: 80,
} as const;
const FOOTER_LINE = 60;
const FOOTER_LINES = 3;
const REASON = 200;
const REASONS = 6;

function unwrapDirections(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const { directions } = parsed as { directions?: unknown };
  if (Array.isArray(directions)) return directions;
  if (typeof directions !== "string") return null;
  try {
    const inner = JSON.parse(directions);
    return Array.isArray(inner) ? inner : null;
  } catch {
    return null;
  }
}

function clampDirection(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const direction = { ...(value as Record<string, unknown>) };
  for (const [field, max] of Object.entries(LIMITS)) {
    const text = direction[field];
    if (typeof text === "string" && text.length > max) {
      direction[field] = clampText(text, max);
    }
  }
  if (Array.isArray(direction.footerLines)) {
    direction.footerLines = direction.footerLines
      .slice(0, FOOTER_LINES)
      .map((line) =>
        typeof line === "string" ? clampText(line, FOOTER_LINE) : line,
      );
  }
  if (Array.isArray(direction.rationale)) {
    direction.rationale = direction.rationale
      .slice(0, REASONS)
      .map((reason) =>
        typeof reason === "string" ? clampText(reason, REASON) : reason,
      );
  }
  return direction;
}

export async function repairDirectionsText({
  text,
}: {
  text: string;
}): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const directions = unwrapDirections(parsed);
  if (!directions) return null;
  const repaired = JSON.stringify({
    directions: directions.map(clampDirection),
  });
  return repaired === text ? null : repaired;
}
