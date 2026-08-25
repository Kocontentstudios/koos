import { requireBrand } from "@/lib/auth/require-brand";
import {
  getRecentConversationsForBrand,
  getStrategiesByBrand,
} from "@/lib/db/queries";
import { groupStrategiesForSidebar } from "@/lib/strategy/sidebar-groups";
import { StrategyClient } from "./strategy-client";

export default async function StrategyPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { dbUser, brand } = await requireBrand();
  const { mode } = await searchParams;
  const initialMode =
    mode === "design" ? ("design" as const) : ("strategy" as const);

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

  void dbUser; // used for auth check via requireBrand

  // Every visit starts a fresh chat; past conversations stay one click away
  // in the history panel (Recent Chats).
  const recentConversations = await getRecentConversationsForBrand(brand.id);

  const { strategyIdByConversation, olderStrategies } =
    groupStrategiesForSidebar(rawStrategies, recentConversations);

  const conversations = recentConversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    mode: c.mode,
    strategyId: strategyIdByConversation.get(c.id) ?? null,
    titleCustom: c.titleCustom,
  }));

  return (
    <StrategyClient
      brandId={brand.id}
      brandName={brand.name}
      brandContext={brandContext}
      olderStrategies={olderStrategies}
      conversations={conversations}
      initialMode={initialMode}
    />
  );
}
