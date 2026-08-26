const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHex(value: string): boolean {
  return HEX_RE.test(value.trim());
}

/**
 * Accepts "#abc", "#AABBCC", "abc123" and returns "#AABBCC", or null for
 * anything else (colour names, rgb(), gradients, model hallucinations).
 *
 * Nullable input is deliberate: the render pipeline feeds this straight from
 * nullable brand columns, so pushing the guard in here keeps every caller from
 * repeating it.
 */
export function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const [r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  return null;
}
