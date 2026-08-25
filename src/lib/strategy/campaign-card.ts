import { type Strategy, strategySchema } from "@/lib/ai/strategy-schema";

/** A strategies row as the campaign card consumes it. */
export interface CampaignCard {
  id: string;
  campaignName: string;
  objective: string;
  /** Named, not counted: "Instagram, WhatsApp" tells the user something
   * "2 channels" does not. */
  channels: string[];
  phaseCount: number;
  /** First and last phase of the timeline, e.g. "Tease → Last call". */
  timelineSpan: string;
  /** "draft" until the user saves it; "active" once committed. */
  status: string;
}

/** The strategies row fields the card is derived from. */
export interface StrategyRowForCard {
  id: string;
  name: string;
  structured: unknown;
  status: string;
  updatedAt: Date | string;
}

export const CAMPAIGN_SAVED_STATUS = "active";

export function isCampaignSaved(card: Pick<CampaignCard, "status">): boolean {
  return card.status === CAMPAIGN_SAVED_STATUS;
}

/**
 * Build the card from a stored row. Returns null when `structured` no longer
 * matches the current schema, so an old strategy degrades to "no card" rather
 * than crashing the chat it lives in.
 */
export function toCampaignCard(row: StrategyRowForCard): CampaignCard | null {
  const parsed = strategySchema.safeParse(row.structured);
  if (!parsed.success) return null;
  return {
    id: row.id,
    ...campaignSummary(parsed.data),
    // The row's name is what the sidebar and older-strategies list show; keep
    // the card on it so a renamed campaign stays consistent across surfaces.
    campaignName: row.name || parsed.data.campaignName,
    status: row.status,
  };
}

/** The scannable half of the card, derived straight from the structured strategy. */
export function campaignSummary(strategy: Strategy) {
  const phases = strategy.timeline.map((t) => t.phase);
  return {
    campaignName: strategy.campaignName,
    objective: strategy.objective,
    channels: strategy.channels.map((c) => c.name),
    phaseCount: phases.length,
    timelineSpan:
      phases.length > 1
        ? `${phases[0]} → ${phases[phases.length - 1]}`
        : (phases[0] ?? ""),
  };
}

/** How many channel names fit one line before it wraps on a phone. */
const MAX_LISTED_CHANNELS = 3;

/** Named channels, capped: "Instagram, WhatsApp, Meta Ads +2". */
export function campaignChannelLine(card: CampaignCard): string {
  const shown = card.channels.slice(0, MAX_LISTED_CHANNELS);
  if (shown.length === 0) return "";
  const overflow = card.channels.length - shown.length;
  return `${shown.join(", ")}${overflow > 0 ? ` +${overflow}` : ""}`;
}

/**
 * The timeline: "3 phases: Anticipation → Opening Week". Kept OFF the channel
 * line — sharing one clamped line meant the span, the only fact here the
 * sidebar does not already show, was always the part truncated away.
 */
export function campaignTimelineLine(card: CampaignCard): string {
  if (!card.phaseCount) return "";
  const phases = `${card.phaseCount} ${card.phaseCount === 1 ? "phase" : "phases"}`;
  return card.timelineSpan ? `${phases}: ${card.timelineSpan}` : phases;
}

/**
 * The title a chat should carry once it has produced a campaign. Mirrors the
 * `title_custom = false` predicate the server's automatic title write uses, so
 * the sidebar never optimistically shows a title the database refused.
 */
export function nextChatTitle(
  existing: { title?: string | null; titleCustom?: boolean } | undefined,
  campaignName: string,
): string | null {
  if (existing?.titleCustom) return existing.title ?? null;
  return campaignName;
}

/**
 * The recap KO posts into the chat when the user hits Review, so refinement
 * turns carry the campaign in context. Persisted as an assistant message —
 * an ephemeral one would leave the user's next reply dangling on reopen.
 */
export function campaignRecap(strategy: Strategy): string {
  // Markdown collapses a single newline into a space, so each field is its own
  // list item. Joining with "\n" produced one unreadable run-on paragraph.
  return [
    `Here's your campaign strategy, **${strategy.campaignName}**.`,
    "",
    `- **Objective:** ${strategy.objective}`,
    `- **Audience:** ${strategy.targetAudience}`,
    `- **Key message:** ${strategy.keyMessage}`,
    `- **Channels:** ${strategy.channels.map((c) => c.name).join(", ")}`,
    "",
    "Tell me what you'd like to change and I'll refine it, then rebuild the strategy.",
  ].join("\n");
}
