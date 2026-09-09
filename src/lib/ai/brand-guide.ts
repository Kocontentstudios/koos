import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";

/**
 * Every field is required and every list is a plain string array.
 *
 * Bedrock compiles this into a constrained-decoding grammar and counts each
 * optional or nullable property as a union-typed parameter, capped at 16 — the
 * same wall documented in onboarding/extraction.ts. Required fields use none.
 */
export const brandGuideSchema = z.object({
  /** Where the voice sits between opposing poles, e.g. "Playful ←→ Serious: leans playful". */
  toneSpectrum: z.array(z.string()).min(2).max(6),
  dos: z.array(z.string()).min(3).max(8),
  donts: z.array(z.string()).min(3).max(8),
  /** Sentence construction, length, punctuation, formatting habits. */
  writingStyleRules: z.array(z.string()).min(3).max(8),
  /** Words to reach for and words to refuse, with the reason. */
  vocabularyGuardrails: z.array(z.string()).min(3).max(8),
  /** Two or three lines showing the voice in use. */
  exampleLines: z.array(z.string()).min(2).max(4),
});

export type BrandGuide = z.infer<typeof brandGuideSchema>;

export interface BrandGuideInput {
  name: string;
  overview?: string | null;
  businessType?: string | null;
  targetAudience?: string | null;
  tone?: string | null;
  values?: string | null;
  wordsLove?: string | null;
  wordsAvoid?: string | null;
}

function knownFacts(brand: BrandGuideInput): string {
  return [
    `Brand: ${brand.name}`,
    brand.businessType ? `Type: ${brand.businessType}` : null,
    brand.overview ? `What they do: ${brand.overview}` : null,
    brand.targetAudience ? `Audience: ${brand.targetAudience}` : null,
    brand.tone ? `Tone words they chose: ${brand.tone}` : null,
    brand.values ? `Values: ${brand.values}` : null,
    brand.wordsLove ? `Words they like: ${brand.wordsLove}` : null,
    brand.wordsAvoid ? `Words to avoid: ${brand.wordsAvoid}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Expands the handful of adjectives captured during onboarding into a usable
 * voice guide.
 *
 * The point of the ticket: recording "Bold, Warm" is not a brand voice. This
 * turns those picks into rules someone could actually write from, and that the
 * strategy and design prompts can be held to.
 *
 * Returns null on any failure — the guide is an enrichment, and onboarding
 * must complete whether or not it lands.
 */
export async function synthesizeBrandGuide(
  brand: BrandGuideInput,
): Promise<BrandGuide | null> {
  try {
    const { object } = await generateObject({
      model: getModel("chat"),
      schema: brandGuideSchema,
      maxOutputTokens: 2000,
      system:
        "You are a brand voice strategist. Given what is known about a brand, write a " +
        "practical voice and messaging guide a copywriter could work from tomorrow. " +
        "Be specific to THIS brand — never generic advice that would fit any company. " +
        "Ground every rule in the tone words, values and audience provided. " +
        "If the brand said to avoid a word, carry that into the guardrails verbatim.",
      prompt: knownFacts(brand),
    });
    return object;
  } catch (err) {
    console.error("brand guide synthesis failed", err);
    return null;
  }
}

/**
 * The guide as prompt text.
 *
 * Only the halves a generator can act on: the tone spectrum and the two rule
 * lists tell a model how to write, while the example lines show it. Kept
 * compact because this rides along with every strategy, calendar and design
 * prompt for a brand that has one.
 *
 * Returns null when there is no guide, so callers emit nothing rather than an
 * empty heading.
 */
export function voiceGuideBlock(guide: BrandGuide | null): string | null {
  if (!guide) return null;
  const parts = [
    guide.toneSpectrum.length > 0
      ? `Tone: ${guide.toneSpectrum.join("; ")}`
      : null,
    guide.dos.length > 0 ? `Always: ${guide.dos.join("; ")}` : null,
    guide.donts.length > 0 ? `Never: ${guide.donts.join("; ")}` : null,
    guide.writingStyleRules.length > 0
      ? `Style rules: ${guide.writingStyleRules.join("; ")}`
      : null,
    guide.vocabularyGuardrails.length > 0
      ? `Vocabulary: ${guide.vocabularyGuardrails.join("; ")}`
      : null,
    guide.exampleLines.length > 0
      ? `Sounds like: ${guide.exampleLines.map((l) => `"${l}"`).join(" ")}`
      : null,
  ].filter(Boolean);
  return parts.length > 0
    ? `Brand voice guide — every line of copy must obey this:\n${parts.join("\n")}`
    : null;
}
