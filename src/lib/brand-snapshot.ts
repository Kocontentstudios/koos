import { MAX_ADDITIONAL_COLORS } from "@/lib/brand-profile";
import { normalizeHex } from "@/lib/validation/hex";

/** Longest a badge can be and still read as a voice adjective rather than a
 *  sentence. Past this the tone is prose and belongs in a paragraph. */
const MAX_BADGE_LENGTH = 24;
/** Enough for the six canonical tone options; past this the row wraps badly. */
const MAX_BADGES = 6;

/** Commas, semicolons, slashes, pipes, ampersands and a spelled-out "and". */
const TONE_SEPARATORS = /\s*(?:[,;/|&]|\band\b)\s*/i;

/**
 * Splits the stored tone into voice badges.
 *
 * `tone` is one free-text column, not a list: the manual form stores a single
 * canonical option ("Friendly & Educational"), "Other (Specify)" stores
 * whatever was typed, and the conversational path stores whatever the model
 * wrote. The design asks for one adjective per badge, so the compound options
 * are split on their ampersand too.
 *
 * Returns an empty array when the result would not read as badges — a tone
 * with no separators and a sentence's worth of words is prose, and the caller
 * shows it as text instead of forcing it into a pill.
 */
export function toneBadges(tone: string | null | undefined): string[] {
  const raw = tone?.trim();
  if (!raw) return [];

  const seen = new Set<string>();
  const badges: string[] = [];
  for (const part of raw.split(TONE_SEPARATORS)) {
    const trimmed = part.trim().replace(/[.]+$/, "");
    if (!trimmed) continue;
    // One oversized fragment means the whole string is prose, not a list.
    if (trimmed.length > MAX_BADGE_LENGTH) return [];
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    badges.push(trimmed);
    if (badges.length === MAX_BADGES) break;
  }
  return badges;
}

export interface PaletteSwatch {
  /** The value as stored, shown beside the dot. */
  value: string;
  /** A renderable CSS colour, or null when the user gave a colour name. */
  hex: string | null;
}

interface PaletteInput {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  additionalColors?: string[] | null;
}

/**
 * Primary, secondary and any additional colours, in that order.
 *
 * Colours are deliberately stored unvalidated — the conversational path keeps
 * what the user actually said, so "green" and "deep forest green" both reach
 * here. A value that is not a hex gets `hex: null` so the caller can label it
 * rather than paint an invisible dot.
 */
export function paletteSwatches(brand: PaletteInput): PaletteSwatch[] {
  const values = [
    brand.primaryColor,
    brand.secondaryColor,
    ...(brand.additionalColors ?? []).slice(0, MAX_ADDITIONAL_COLORS),
  ];

  const seen = new Set<string>();
  const swatches: PaletteSwatch[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    swatches.push({ value: trimmed, hex: normalizeHex(trimmed) });
  }
  return swatches;
}

/**
 * The pill under the brand name: "E-commerce / Product — Early (0–50 customers)".
 * Either half may be missing, so the dash only appears between two real values.
 */
export function identityLine(
  businessType: string | null | undefined,
  stage: string | null | undefined,
): string | null {
  const parts = [businessType, stage]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" — ") : null;
}

/** Fields the snapshot card reads, picked off a brands row. Kept here so both
 *  completion paths return the same shape to their clients. */
export interface BrandSnapshotFields {
  name: string;
  logoUrl: string | null;
  overview: string | null;
  businessType: string | null;
  stage: string | null;
  targetAudience: string | null;
  tone: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  additionalColors: string[] | null;
}

export function toBrandSnapshot(brand: {
  name: string;
  logoUrl?: string | null;
  overview?: string | null;
  businessType?: string | null;
  stage?: string | null;
  targetAudience?: string | null;
  tone?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  additionalColors?: string[] | null;
}): BrandSnapshotFields {
  return {
    name: brand.name,
    logoUrl: brand.logoUrl ?? null,
    overview: brand.overview ?? null,
    businessType: brand.businessType ?? null,
    stage: brand.stage ?? null,
    targetAudience: brand.targetAudience ?? null,
    tone: brand.tone ?? null,
    primaryColor: brand.primaryColor ?? null,
    secondaryColor: brand.secondaryColor ?? null,
    additionalColors: brand.additionalColors ?? null,
  };
}
