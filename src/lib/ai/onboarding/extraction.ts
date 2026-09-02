import { z } from "zod";

// Caps input-token spend per request; an onboarding conversation is a short
// back-and-forth, not a full transcript dump.
export const MAX_TRANSCRIPT_LENGTH = 8000;

export const EXTRACTION_OUTPUT_TOKEN_CAP = 4000;

export const bodySchema = z.object({
  brandId: z.string().uuid(),
  transcript: z.string().min(1).max(MAX_TRANSCRIPT_LENGTH),
});

/**
 * Every field is a plain required string. A field the conversation never
 * covered comes back as "", which omitUnfilled strips before the proposal is
 * built — the empty string is the sentinel, not null and not an absent key.
 *
 * Bedrock compiles this schema into a constrained-decoding grammar before it
 * generates a token, and it counts every optional OR nullable property as a
 * union-typed parameter. Both forms were tried and both were rejected at 17
 * fields: `.optional()` died with "Grammar compilation timed out" (400 after
 * 3.1 minutes), and `.nullable()` with "too many parameters with union types
 * (17 … limit: 16)". Plain strings use zero unions, so the field count can
 * grow past 17 without hitting either wall.
 *
 * Mirrors ProposalSchema's brand_fields shape exactly — every key here must
 * stay in lockstep with that union member, or a valid extraction gets
 * silently stripped when we validate the built proposal below.
 */
const extractedField = z.string();

export const extractionSchema = z.object({
  fields: z.object({
    name: extractedField,
    overview: extractedField,
    businessType: extractedField,
    stage: extractedField,
    targetAudience: extractedField,
    offer: extractedField,
    tone: extractedField,
    primaryGoal: extractedField,
    values: extractedField,
    wordsLove: extractedField,
    wordsAvoid: extractedField,
    brandStyle: extractedField,
    competitors: extractedField.describe(
      "Who else is in the space, by name. Names only — not what anyone is good at.",
    ),
    /* The two below are mirror images and the only other thing separating them
       is the key name, so each says whose advantage it holds. Without this the
       model has nothing to go on and can swap them. */
    competitorStrengths: extractedField.describe(
      "What the COMPETITORS are good at — their strengths, where they are hard to beat. Never this brand's own advantages.",
    ),
    differentiators: extractedField.describe(
      "What THIS brand does differently or better than its competitors — its own advantages. Never the competitors' strengths.",
    ),
    primaryColor: extractedField,
    secondaryColor: extractedField,
    additionalColors: extractedField.describe(
      "Any brand colours beyond the primary and secondary, comma-separated, at most 3. Hex or colour name, whichever the user said. Empty string if none were mentioned.",
    ),
    additionalNotes: extractedField,
  }),
  summary: z.string(),
});

export const SYSTEM_PROMPT = [
  "You extract structured brand-profile fields from an onboarding conversation transcript.",
  "Only fill a field when the transcript states or clearly implies it — never invent or assume a value.",
  "Return an empty string for any field the transcript doesn't cover — never guess a value to fill it.",
  "Keep each field concrete and concise, matching how it would appear on a brand profile form (no preamble, no restating the question).",
  "Write a one-sentence `summary` describing what was captured, for a confirm-to-fill UI card.",
].join(" ");

export function omitUnfilled<T extends Record<string, unknown>>(
  obj: T,
): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    out[key as keyof T] = value as T[keyof T];
  }
  return out;
}
