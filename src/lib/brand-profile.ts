export interface BrandProfileInput {
  name?: string | null;
  overview?: string | null;
  businessType?: string | null;
  stage?: string | null;
  targetAudience?: string | null;
  offer?: string | null;
  tone?: string | null;
  primaryGoal?: string | null;
  values?: string | null;
  wordsLove?: string | null;
  wordsAvoid?: string | null;
  brandStyle?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  additionalColors?: string[] | null;
  logoUrl?: string | null;
  platforms?: string[] | null;
  primaryPlatform?: string | null;
  postingFrequency?: string | null;
}

/** Placeholder name a conversational draft is created with, so the NOT NULL
 *  column has a value before the user has said what the brand is called. */
export const PLACEHOLDER_BRAND_NAME = "Untitled brand";

/** The four fields the manual form marks required and validates at step 1. */
const REQUIRED_FIELDS = [
  "name",
  "overview",
  "businessType",
  "stage",
] as const satisfies readonly (keyof BrandProfileInput)[];

/**
 * Section weights from KOS-V1-BUG-001. They total 100 on their own, which is
 * why Competitors and Anything Else score nothing: there is no room left for
 * them, and both are explicitly optional in the form.
 */
const SECTIONS = [
  { weight: 20, fields: REQUIRED_FIELDS },
  { weight: 25, fields: ["targetAudience", "offer", "tone", "primaryGoal"] },
  {
    weight: 25,
    fields: ["logoUrl", "brandStyle", "primaryColor", "secondaryColor"],
  },
  { weight: 15, fields: ["values", "wordsLove", "wordsAvoid"] },
  { weight: 15, fields: ["platforms", "primaryPlatform", "postingFrequency"] },
] as const satisfies readonly {
  weight: number;
  fields: readonly (keyof BrandProfileInput)[];
}[];

function isFilled(input: BrandProfileInput, field: keyof BrandProfileInput) {
  const value = input[field];
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== "string" || value.trim().length === 0) return false;
  // The placeholder is ours, not something the user told us — counting it
  // would report progress for a draft that knows nothing yet.
  return !(field === "name" && value.trim() === PLACEHOLDER_BRAND_NAME);
}

/** True once every field the manual form requires has a real value. */
export function isBasicsComplete(input: BrandProfileInput): boolean {
  return REQUIRED_FIELDS.every((field) => isFilled(input, field));
}

/**
 * 0-100, weighted across the five scored sections.
 *
 * This is a reporting number only. It deliberately does NOT decide whether
 * onboarding is finished: gating on 100% would trap every user who left an
 * optional section blank outside the dashboard forever. See
 * progressAfterFieldWrite.
 */
export function brandProfileCompletion(input: BrandProfileInput): number {
  const score = SECTIONS.reduce((total, section) => {
    const filled = section.fields.filter((f) => isFilled(input, f)).length;
    return total + (section.weight * filled) / section.fields.length;
  }, 0);
  return Math.round(score);
}

export function hasCompletedBrand(
  onboardingStatus: string | null | undefined,
): boolean {
  return onboardingStatus === "completed";
}

export type OnboardingStatus = "draft" | "in_progress" | "completed";

export interface OnboardingProgress {
  completionPercentage: number;
  onboardingStatus: OnboardingStatus;
}

/**
 * Progress for a brand after AI-extracted fields are confirmed onto it.
 *
 * Without this the conversational path is a dead end: /api/actions/confirm
 * wrote the fields but left onboardingStatus at "draft", so requireBrand kept
 * bouncing the user back into onboarding no matter how much they told KO.
 *
 * The status gate is the required Basics fields, NOT the percentage. Those
 * were the same condition while the score counted only those four fields;
 * once the score spread across five sections they stopped being the same, and
 * requireBrand redirects on anything short of "completed".
 */
export function progressAfterFieldWrite(
  merged: BrandProfileInput,
): OnboardingProgress {
  const completionPercentage = brandProfileCompletion(merged);
  if (isBasicsComplete(merged)) {
    return { completionPercentage, onboardingStatus: "completed" };
  }
  return {
    completionPercentage,
    onboardingStatus: completionPercentage > 0 ? "in_progress" : "draft",
  };
}

/** Spec cap: Primary + Secondary + up to 3 more (KO_OS UI.Specification.md:860). */
export const MAX_ADDITIONAL_COLORS = 3;
const MAX_COLOR_LENGTH = 40;

/** A brand can be on every social plus a newsletter plus a messaging app, so
 *  this sits well above the picker's option count — it exists to stop a
 *  run-on answer bloating the column, not to limit real channels. */
const MAX_PLATFORMS = 20;

/**
 * Makes a model's free-text channel list safe for the `platforms` text[]
 * column. Free text on purpose, like the colours: the Brand Profile form's own
 * platform picker carries an "Other" box, so a channel outside the known list
 * is a legitimate answer, not a parsing failure.
 */
export function parsePlatformList(
  value: string | string[] | null | undefined,
): string[] {
  const raw = Array.isArray(value) ? value : (value ?? "").split(/[,;\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const trimmed = String(entry).trim().slice(0, MAX_COLOR_LENGTH);
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length === MAX_PLATFORMS) break;
  }
  return out;
}

/**
 * Makes a model's free-text colour list safe for the `additional_colors`
 * text[] column. Never validates hex on purpose: the conversational path
 * legitimately stores colour names — the onboarding eval asserts primaryColor
 * contains "green" — and normalising would discard what the user actually said.
 */
export function parseAdditionalColors(
  value: string | string[] | null | undefined,
): string[] {
  const raw = Array.isArray(value) ? value : (value ?? "").split(/[,;\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const trimmed = String(entry).trim().slice(0, MAX_COLOR_LENGTH);
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length === MAX_ADDITIONAL_COLORS) break;
  }
  return out;
}
