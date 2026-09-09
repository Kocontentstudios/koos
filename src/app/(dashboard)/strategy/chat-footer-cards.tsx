"use client";

import type { CampaignCard } from "@/lib/strategy/campaign-card";
import {
  DesignBriefCard,
  type PersistedDesignBrief,
} from "./design-brief-card";
import { StrategyCard } from "./strategy-card";

interface ChatFooterCardsProps {
  isDesignMode: boolean;
  briefs: PersistedDesignBrief[];
  onOpenBrief: (briefId: string) => void;
  campaign: CampaignCard | null;
  onOpenCampaign: (strategyId: string) => void;
  onReviewCampaign: (strategyId: string) => void;
  onSaveCampaign: (strategyId: string) => void;
  onGenerateCalendar: () => void;
  opening: boolean;
  saving: boolean;
  reviewing: boolean;
  generatingCalendar: boolean;
  cardError: string | null;
}

/**
 * What a chat pins under its messages: design briefs in design mode, the
 * chat's one campaign in strategy mode. A design chat never shows a campaign
 * card and vice versa, so the two modes can't blur into each other.
 */
export function ChatFooterCards({
  isDesignMode,
  briefs,
  onOpenBrief,
  campaign,
  onOpenCampaign,
  onReviewCampaign,
  onSaveCampaign,
  onGenerateCalendar,
  opening,
  saving,
  reviewing,
  generatingCalendar,
  cardError,
}: ChatFooterCardsProps) {
  if (isDesignMode) {
    if (briefs.length === 0) return null;
    return (
      <div className="flex flex-col gap-2 pl-10">
        {briefs.map((b) => (
          <DesignBriefCard key={b.id} brief={b} onOpen={onOpenBrief} />
        ))}
      </div>
    );
  }

  if (!campaign) return null;
  return (
    <div className="flex flex-col gap-2 pl-10">
      {/* Keyed by campaign: reusing the instance across chats would replay the
          live region's "Saved." transition on a card that merely loaded. */}
      <StrategyCard
        key={campaign.id}
        campaign={campaign}
        onOpen={onOpenCampaign}
        onReview={onReviewCampaign}
        onSave={onSaveCampaign}
        onGenerateCalendar={onGenerateCalendar}
        opening={opening}
        saving={saving}
        reviewing={reviewing}
        generatingCalendar={generatingCalendar}
        error={cardError}
      />
    </div>
  );
}
