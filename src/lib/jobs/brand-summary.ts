import type { BrandSummary } from "@/lib/ai/prompts/strategy";
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
