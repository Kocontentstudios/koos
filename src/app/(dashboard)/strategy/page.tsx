import { requireBrand } from "@/lib/auth/require-brand";
import {
  getRecentConversationsForBrand,
  getStrategiesByBrand,
} from "@/lib/db/queries";
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

  // Latest strategy per chat (rawStrategies is updatedAt-desc) — surfaced as
  // the chat's "View Strategy" action instead of a separate sidebar list.
  const latestStrategyIdByConversation = new Map<string, string>();
  for (const s of rawStrategies) {
    if (
      s.conversationId &&
      !latestStrategyIdByConversation.has(s.conversationId)
    ) {
      latestStrategyIdByConversation.set(s.conversationId, s.id);
    }
  }

  const conversations = recentConversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    mode: c.mode,
    strategyId: latestStrategyIdByConversation.get(c.id) ?? null,
  }));

  // Anything not reachable through a listed chat (no conversation, chat fell
  // off the recent list, or superseded by a newer strategy in the same chat)
  // stays reachable in the sidebar's "Older Strategies" group.
  const reachableViaChat = new Set(
    conversations.map((c) => c.strategyId).filter(Boolean),
  );
  const olderStrategies = rawStrategies
    .filter((s) => !reachableViaChat.has(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      updatedAt: s.updatedAt,
      status: s.status,
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
