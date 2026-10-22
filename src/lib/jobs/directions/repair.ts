import { DRAFT_LIMITS } from "./schema";

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
 * Text fields over the draft schema's parse limits, which sit far past the
 * contract, are shortened at a word boundary only so the answer parses; the
 * fit pass in brief.ts then has the model rewrite them, and finalize.ts never
 * draws a cut clause. Anything else (a missing field, a wrong enum) is left
 * to fail, because inventing a value is worse than asking again.
 */

const LIMITS = {
  headline: DRAFT_LIMITS.headline,
  subheadline: DRAFT_LIMITS.subheadline,
  cta: DRAFT_LIMITS.cta,
  title: DRAFT_LIMITS.title,
  productName: DRAFT_LIMITS.productName,
  productLook: DRAFT_LIMITS.productLook,
} as const;

function clampWords(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1).lastIndexOf(" ");
  return clean.slice(0, cut > 0 ? cut : max).trim();
}

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
      direction[field] = clampWords(text, max);
    }
  }
  /* Seen shapes that are the right content in the wrong container. */
  if (direction.footerLines === null) direction.footerLines = [];
  if (typeof direction.footerLines === "string") {
    direction.footerLines = direction.footerLines.trim()
      ? [direction.footerLines]
      : [];
  }
  if (typeof direction.rationale === "string") {
    direction.rationale = direction.rationale
      .split(/(?<=[.!?])\s+|\n+/)
      .map((reason) => reason.trim())
      .filter(Boolean);
  }
  if (Array.isArray(direction.footerLines)) {
    direction.footerLines = direction.footerLines
      .slice(0, DRAFT_LIMITS.footerLines)
      .map((line) =>
        typeof line === "string"
          ? clampWords(line, DRAFT_LIMITS.footerLine)
          : line,
      );
  }
  if (Array.isArray(direction.rationale)) {
    direction.rationale = direction.rationale
      .slice(0, DRAFT_LIMITS.reasons)
      .map((reason) =>
        typeof reason === "string"
          ? clampWords(reason, DRAFT_LIMITS.reason)
          : reason,
      );
  }
  return direction;
}

export async function repairDirectionsText({
  text,
  count,
}: {
  text: string;
  /** How many directions were asked for. A regenerate asks for one while
   *  showing the model two, and an answer with both is the asked-for one
   *  first, not an unusable response. */
  count?: number;
}): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const directions = unwrapDirections(parsed);
  if (!directions) return null;
  const kept =
    count !== undefined && directions.length > count
      ? directions.slice(0, count)
      : directions;
  const repaired = JSON.stringify({
    directions: kept.map(clampDirection),
  });
  return repaired === text ? null : repaired;
}

/** repairDirectionsText for a call that asked for `count` directions. */
export function repairDirectionsFor(count: number) {
  return ({ text }: { text: string }) => repairDirectionsText({ text, count });
}

/**
 * The fit pass's answer, rescued from the same two shapes: `fixes` as a JSON
 * string, or the array bare. The first round-2 eval run lost a whole
 * rewrite to "No object generated" on the real model.
 */
export async function repairFitText({
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
  let fixes: unknown = Array.isArray(parsed)
    ? parsed
    : (parsed as { fixes?: unknown } | null)?.fixes;
  if (typeof fixes === "string") {
    const raw = fixes;
    try {
      fixes = JSON.parse(raw);
    } catch {
      /* Seen on the real model: the string held unescaped quotes from the
         copy it was rewriting ("The word "Free" appears…"), so it is not
         JSON. Each entry still has a readable shape. */
      fixes = [
        ...raw.matchAll(
          /\{\s*"id"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"(.*?)"\s*\}(?=\s*(,|\]|$))/g,
        ),
      ].map((m) => ({ id: m[1], text: m[2] }));
    }
  }
  if (!Array.isArray(fixes)) return null;
  const repaired = JSON.stringify({ fixes });
  return repaired === text ? null : repaired;
}
