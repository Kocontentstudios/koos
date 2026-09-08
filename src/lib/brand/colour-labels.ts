/**
 * Names for a brand's additional colours.
 *
 * Stored in `additional_color_labels`, a second array index-aligned with
 * `additional_colors`, rather than migrating the values to jsonb pairs. The
 * values column feeds the render palette, the brand export, the AI extraction
 * chain and the design-request modal; changing its type would touch every one
 * of those for a feature that only display and the profile form read. The cost
 * is an alignment invariant, so it is handled here — totally, in one pure
 * function — instead of being left as a rule everyone has to remember.
 */

/** What an unnamed colour is called. Positional, so it never collides. */
export function defaultColourLabel(index: number): string {
  return `Additional ${index + 1}`;
}

export interface LabelledColour {
  /** Free text, not necessarily hex — see brand colour columns. */
  value: string;
  label: string;
  /** Whether the label is the positional default rather than the user's. */
  isDefault: boolean;
}

/**
 * Pairs values with their labels, whatever state the two arrays are in.
 *
 * Total by construction: a labels array that is shorter, longer, sparse, or
 * absent entirely still produces exactly one entry per VALUE. The values are
 * what exist; a label is decoration on top of one.
 */
export function pairColourLabels(
  values: readonly (string | null | undefined)[] | null | undefined,
  labels: readonly (string | null | undefined)[] | null | undefined,
): LabelledColour[] {
  return (
    (values ?? [])
      .map((value, index) => {
        const named = labels?.[index]?.trim();
        return {
          value: value?.trim() ?? "",
          label: named || defaultColourLabel(index),
          isDefault: !named,
        };
      })
      /* A blank value is not a colour, and a label with nothing under it is not
       worth a row. Filtered AFTER indexing so the remaining labels keep the
       positions their values had. */
      .filter((entry) => entry.value.length > 0)
  );
}

/**
 * The labels array to store for a given set of values.
 *
 * Written as an empty string wherever the user has not named a colour, so the
 * array stays index-aligned with the values rather than collapsing and
 * shifting every later label onto the wrong swatch. Trimmed to the number of
 * values, because a label for a colour that no longer exists would silently
 * reattach to whatever is added next.
 */
export function labelsToStore(
  labels: readonly (string | null | undefined)[] | null | undefined,
  valueCount: number,
): string[] {
  return Array.from({ length: valueCount }, (_, i) => {
    const named = labels?.[i]?.trim() ?? "";
    /* The positional default is not the user's text — storing it would make
       "Additional 2" stick to a colour that later moves to position 1. */
    return named === defaultColourLabel(i) ? "" : named;
  });
}

/** Cap so a label stays a label rather than a paragraph. */
export const MAX_COLOUR_LABEL = 40;

export function sanitiseColourLabel(label: string): string {
  return label.trim().slice(0, MAX_COLOUR_LABEL);
}

/**
 * The labels to store beside a SANITISED value list.
 *
 * parseAdditionalColors does more than trim: it drops blanks, truncates each
 * entry, de-duplicates case-insensitively and caps the count. Any of those
 * shortens the array, and pairing by position afterwards would slide every
 * later label onto the wrong colour — a brand that entered the same hex twice
 * would end up with its second name on a third colour.
 *
 * So labels are matched to the values that SURVIVED, by value, rather than
 * assuming the two lists still line up. First occurrence wins, which is the
 * one de-duplication keeps.
 */
export function alignLabelsToColours(
  rawValues: readonly (string | null | undefined)[] | null | undefined,
  rawLabels: readonly (string | null | undefined)[] | null | undefined,
  storedValues: readonly string[],
): string[] {
  const named = new Map<string, string>();
  (rawValues ?? []).forEach((value, index) => {
    const key = value?.trim().toLowerCase();
    if (!key || named.has(key)) return;
    const label = rawLabels?.[index]?.trim() ?? "";
    named.set(key, label === defaultColourLabel(index) ? "" : label);
  });

  return storedValues.map(
    (value) => named.get(value.trim().toLowerCase()) ?? "",
  );
}
