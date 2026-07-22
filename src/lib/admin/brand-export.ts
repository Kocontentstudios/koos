import type { brands } from "@/lib/db/schema";

type BrandRow = typeof brands.$inferSelect;

export interface BrandExport {
  id: string;
  name: string;
  onboardingStatus: string;
  completionPercentage: number;
  createdAt: string;
  updatedAt: string;
  sections: {
    basics: Pick<
      BrandRow,
      "overview" | "businessType" | "stage" | "primaryGoal"
    >;
    audience: Pick<BrandRow, "targetAudience" | "offer" | "tone">;
    personality: Pick<BrandRow, "values" | "wordsLove" | "wordsAvoid">;
    visual: Pick<
      BrandRow,
      | "logoUrl"
      | "hasLogo"
      | "brandStyle"
      | "primaryColor"
      | "secondaryColor"
      | "additionalColors"
    >;
    competitors: Pick<
      BrandRow,
      "competitors" | "competitorStrengths" | "differentiators"
    >;
    platforms: Pick<
      BrandRow,
      "platforms" | "primaryPlatform" | "postingFrequency"
    >;
    additional: Pick<BrandRow, "additionalNotes" | "helpfulLinks">;
  };
}

/** Shape a brand row for admin export, grouped the same way the onboarding
 * form asks for it so an admin reading the JSON recognizes the structure.
 * Null fields are kept: a missing answer is information. */
export function toBrandExport(brand: BrandRow): BrandExport {
  return {
    id: brand.id,
    name: brand.name,
    onboardingStatus: brand.onboardingStatus,
    completionPercentage: brand.completionPercentage,
    createdAt: brand.createdAt.toISOString(),
    updatedAt: brand.updatedAt.toISOString(),
    sections: {
      basics: {
        overview: brand.overview,
        businessType: brand.businessType,
        stage: brand.stage,
        primaryGoal: brand.primaryGoal,
      },
      audience: {
        targetAudience: brand.targetAudience,
        offer: brand.offer,
        tone: brand.tone,
      },
      personality: {
        values: brand.values,
        wordsLove: brand.wordsLove,
        wordsAvoid: brand.wordsAvoid,
      },
      visual: {
        logoUrl: brand.logoUrl,
        hasLogo: brand.hasLogo,
        brandStyle: brand.brandStyle,
        primaryColor: brand.primaryColor,
        secondaryColor: brand.secondaryColor,
        additionalColors: brand.additionalColors,
      },
      competitors: {
        competitors: brand.competitors,
        competitorStrengths: brand.competitorStrengths,
        differentiators: brand.differentiators,
      },
      platforms: {
        platforms: brand.platforms,
        primaryPlatform: brand.primaryPlatform,
        postingFrequency: brand.postingFrequency,
      },
      additional: {
        additionalNotes: brand.additionalNotes,
        helpfulLinks: brand.helpfulLinks,
      },
    },
  };
}

export function brandExportFilename(brand: { name: string }): string {
  const slug = brand.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}-brand.json` : "brand.json";
}
