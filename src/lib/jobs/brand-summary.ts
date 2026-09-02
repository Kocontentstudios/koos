import { voiceGuideBlock } from "@/lib/ai/brand-guide";
import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import { getBrandVoiceGuide } from "@/lib/db/queries";
import type { brands } from "@/lib/db/schema";

export type { BrandSummary };

type BrandRow = typeof brands.$inferSelect;

/** Extracted from run-generation so callers that only need brand context
 * (e.g. the design context resolver) do not pull in the whole job runner,
 * which imports them back. */
export function brandSummaryFrom(brand: BrandRow): BrandSummary {
  return {
    name: brand.name,
    overview: brand.overview,
    businessType: brand.businessType,
    stage: brand.stage,
    targetAudience: brand.targetAudience,
    offer: brand.offer,
    tone: brand.tone,
    primaryGoal: brand.primaryGoal,
    values: brand.values,
    wordsLove: brand.wordsLove,
    wordsAvoid: brand.wordsAvoid,
    brandStyle: brand.brandStyle,
    brandFont: brand.brandFont,
    competitors: brand.competitors,
    competitorStrengths: brand.competitorStrengths,
    differentiators: brand.differentiators,
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor,
    additionalColors: brand.additionalColors,
    platforms: brand.platforms,
    primaryPlatform: brand.primaryPlatform,
    postingFrequency: brand.postingFrequency,
  };
}

/**
 * The summary plus the brand's voice guide, for the prompts that write copy.
 *
 * Separate from the sync version on purpose: the guide lives in brand_contexts
 * rather than on the brand row, and most callers of brandSummaryFrom neither
 * need it nor can await. A brand without a guide gets a summary identical to
 * the sync one, so no existing prompt changes.
 */
export async function brandSummaryWithVoice(
  brand: BrandRow,
): Promise<BrandSummary> {
  const guide = await getBrandVoiceGuide(brand.id);
  return { ...brandSummaryFrom(brand), voiceGuide: voiceGuideBlock(guide) };
}
