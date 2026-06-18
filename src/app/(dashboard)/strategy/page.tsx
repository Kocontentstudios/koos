import { requireBrand } from "@/lib/auth/require-brand";
import { getStrategiesByBrand } from "@/lib/db/queries";
import { StrategyClient } from "./strategy-client";

export default async function StrategyPage() {
  const { dbUser, brand } = await requireBrand();

  const brandContext = {
    brandProfile: [
      brand.name,
      brand.overview ?? "",
      brand.businessType ? `Business type: ${brand.businessType}` : "",
      brand.stage ? `Stage: ${brand.stage}` : "",
      brand.primaryGoal ? `Primary goal: ${brand.primaryGoal}` : "",
      brand.offer ? `Offer: ${brand.offer}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    audience: brand.targetAudience ?? "",
    brandVoice: brand.tone ?? "",
    existingCampaigns: "",
    previousConversations: "",
  };

  const rawStrategies = await getStrategiesByBrand(brand.id);
  const pastStrategies = rawStrategies.map((s) => ({
    id: s.id,
    name: s.name,
    updatedAt: s.updatedAt,
  }));

  void dbUser; // used for auth check via requireBrand

  return (
    <StrategyClient
      brandId={brand.id}
      brandName={brand.name}
      brandContext={brandContext}
      pastStrategies={pastStrategies}
    />
  );
}
