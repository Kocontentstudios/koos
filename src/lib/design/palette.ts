export interface ResolvedPalette {
  background: string;
  foreground: string;
  accent: string;
}

export interface RawPalette {
  background: string;
  foreground: string;
  accent: string;
}

interface BrandColors {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  additionalColors?: (string | null)[] | null;
}

const NEUTRAL_DARK = "#111111";
const NEUTRAL_LIGHT = "#FFFFFF";
const NEUTRAL_ACCENT = "#2563EB";

/** WCAG AA for large text. Headlines are always large here, so 3:1 would be
 * defensible — 4.5 is used because subheadlines and CTAs are not. */
export const MIN_CONTRAST_RATIO = 4.5;

/** Accepts "#abc", "#AABBCC", "abc123" and returns "#AABBCC", or null for
 * anything else (colour names, rgb(), gradients, model hallucinations). */
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

export function relativeLuminance(hex: string): number {
  const value = normalizeHex(hex) ?? NEUTRAL_DARK;
  const channels = [1, 3, 5].map((i) => {
    const c = Number.parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ReadablePair {
  foreground: string;
  background: string;
}

function channels(hex: string): [number, number, number] {
  const value = normalizeHex(hex) ?? NEUTRAL_DARK;
  return [1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function mixToward(hex: string, target: string, amount: number): string {
  const from = channels(hex);
  const to = channels(target);
  const hexPair = (n: number) =>
    Math.round(n).toString(16).padStart(2, "0").toUpperCase();
  return `#${from.map((c, i) => hexPair(c + (to[i] - c) * amount)).join("")}`;
}

/**
 * Guarantees a readable text/background pair.
 *
 * Both colours are returned because the guarantee cannot always be met by
 * changing text alone: for backgrounds in the mid-luminance band (~0.175-0.183)
 * neither pure black nor pure white reaches 4.5:1. There the background is
 * nudged away from the text colour until it clears the bar — a small shift in
 * the brand colour is far less costly than an unreadable headline.
 */
export function ensureReadablePair(
  preferred: string,
  background: string,
): ReadablePair {
  const bg = normalizeHex(background) ?? NEUTRAL_LIGHT;
  const fg = normalizeHex(preferred) ?? NEUTRAL_DARK;

  if (contrastRatio(fg, bg) >= MIN_CONTRAST_RATIO) {
    return { foreground: fg, background: bg };
  }

  const best =
    contrastRatio(NEUTRAL_DARK, bg) >= contrastRatio(NEUTRAL_LIGHT, bg)
      ? NEUTRAL_DARK
      : NEUTRAL_LIGHT;
  if (contrastRatio(best, bg) >= MIN_CONTRAST_RATIO) {
    return { foreground: best, background: bg };
  }

  const away = best === NEUTRAL_DARK ? NEUTRAL_LIGHT : NEUTRAL_DARK;
  for (let step = 1; step <= 20; step++) {
    const adjusted = mixToward(bg, away, step * 0.05);
    if (contrastRatio(best, adjusted) >= MIN_CONTRAST_RATIO) {
      return { foreground: best, background: adjusted };
    }
  }
  return { foreground: best, background: away };
}

/** Turns whatever the model emitted into three guaranteed-hex, guaranteed-
 * readable colours, falling back to the brand's own palette before neutrals. */
export function resolvePalette(
  raw: Partial<RawPalette> | null | undefined,
  brand: BrandColors,
): ResolvedPalette {
  const brandPrimary = normalizeHex(brand.primaryColor);
  const brandSecondary = normalizeHex(brand.secondaryColor);
  /* Only the accent draws on the extra swatches. Background/foreground stay
     on primary because ensureReadablePair guarantees the 4.5:1 floor from
     that one anchor; feeding it a third colour would widen what it has to
     rescue for no gain. Non-hex entries (the AI path stores colour names)
     drop out here — the renderer needs a real value. */
  const brandExtra =
    (brand.additionalColors ?? [])
      .map(normalizeHex)
      .find((c): c is string => c !== null) ?? null;

  const accent =
    normalizeHex(raw?.accent) ??
    brandSecondary ??
    brandExtra ??
    brandPrimary ??
    NEUTRAL_ACCENT;
  const { foreground, background } = ensureReadablePair(
    normalizeHex(raw?.foreground) ?? NEUTRAL_DARK,
    normalizeHex(raw?.background) ?? brandPrimary ?? NEUTRAL_LIGHT,
  );

  return { background, foreground, accent };
}
