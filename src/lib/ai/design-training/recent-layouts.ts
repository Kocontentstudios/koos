/**
 * What this brand's recent designs looked like — module 06 §7-8.
 *
 * The manual asks the designer to compare a new design against recent ones and
 * prefer a layout family that has not been overused. KO OS already had the
 * evidence: `design_generations.spec` has recorded the chosen layout since the
 * feature shipped. Nothing ever read it back, so every generation re-rolled
 * blind and the same composition could repeat indefinitely.
 *
 * Read back rather than tracked in a new table: the data is already there, and
 * a second store would be a second thing to keep in step with the first.
 */

/** How far back to look. Far enough to see a rut, short enough that a brand's
 *  style a year ago does not constrain today's campaign. */
export const LAYOUT_MEMORY_DEPTH = 6;

/** Only the shape this needs: rows come from listDesignGenerationsForBrand,
 *  whose `spec` is jsonb and therefore anything at all. */
interface GenerationLike {
  spec?: unknown;
}

export function recentLayouts(
  rows: GenerationLike[],
  { limit = LAYOUT_MEMORY_DEPTH }: { limit?: number } = {},
): string[] {
  const layouts: string[] = [];
  for (const row of rows) {
    if (layouts.length >= limit) break;
    const spec = row?.spec;
    if (!spec || typeof spec !== "object") continue;
    const layout = (spec as { layout?: unknown }).layout;
    if (typeof layout === "string" && layout.trim()) layouts.push(layout);
  }
  return layouts;
}

/**
 * The anti-repetition instruction, proportional to the rut.
 *
 * Returns an empty string for a brand with no history: there is nothing to
 * avoid, and inventing a constraint from no evidence would push the first
 * design of a brand away from the layout that actually suits it.
 */
export function layoutMemoryBlock(layouts: string[]): string {
  if (layouts.length === 0) return "";

  const counts = new Map<string, number>();
  for (const layout of layouts) {
    counts.set(layout, (counts.get(layout) ?? 0) + 1);
  }
  const [dominant, dominantCount] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0];

  /* One prior use is not a rut; three of the last three is. The pressure has to
     match, or the model either ignores a limp hint or avoids a layout that was
     only used once and genuinely fits. */
  const pressure =
    dominantCount >= 3
      ? `"${dominant}" has carried every one of the last ${dominantCount} designs for this brand. Use a different family this time unless the brief truly leaves no alternative.`
      : dominantCount === 2
        ? `"${dominant}" has been used twice recently. Prefer another family if one suits the content equally well.`
        : "Prefer a family that is not in that list when one suits the content equally well.";

  return [
    `Recent layouts for this brand, most recent first: ${layouts.join(", ")}.`,
    pressure,
    "Choose the family that fits the content, never a random one — variation that does not serve the message is just noise.",
    "Repeat a recent layout deliberately when this is part of a series, when the information structure is identical to the last design, or when the brand has an established template for this kind of post.",
  ].join(" ");
}
