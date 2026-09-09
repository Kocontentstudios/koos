/** The strategies-row fields the sidebar grouping needs. */
export interface StrategyForSidebar {
  id: string;
  name: string;
  status: string;
  conversationId: string | null;
  updatedAt: Date;
}

export interface ChatForSidebar {
  id: string;
}

export interface SidebarGroups {
  /** Chat id → the strategy that chat's Campaign badge points at. */
  strategyIdByConversation: Map<string, string>;
  /** Strategies not reachable through any listed chat. */
  olderStrategies: StrategyForSidebar[];
}

/**
 * Split a brand's strategies into "the campaign this chat owns" and "campaigns
 * only reachable from the Older Strategies list".
 *
 * Archived rows are earlier versions of a campaign whose current version is
 * still reachable through its own chat, so they appear in neither group.
 * Ordering is by `strategies` input order (newest first) among live rows only:
 * ordering by recency across all rows once promoted a superseded version above
 * the version that superseded it.
 */
export function groupStrategiesForSidebar(
  strategies: StrategyForSidebar[],
  chats: ChatForSidebar[],
): SidebarGroups {
  const live = strategies.filter((s) => s.status !== "archived");

  const strategyIdByConversation = new Map<string, string>();
  for (const s of live) {
    if (s.conversationId && !strategyIdByConversation.has(s.conversationId)) {
      strategyIdByConversation.set(s.conversationId, s.id);
    }
  }

  const reachable = new Set(
    chats
      .map((c) => strategyIdByConversation.get(c.id))
      .filter((id): id is string => Boolean(id)),
  );

  return {
    strategyIdByConversation,
    olderStrategies: live.filter((s) => !reachable.has(s.id)),
  };
}
