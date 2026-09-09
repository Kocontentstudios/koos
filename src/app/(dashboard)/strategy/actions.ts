"use server";

import { type Strategy, strategySchema } from "@/lib/ai/strategy-schema";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { requireBrand } from "@/lib/auth/require-brand";
import {
  archiveSupersededStrategies,
  createMessage,
  getStrategyById,
  touchConversation,
  updateStrategy,
} from "@/lib/db/queries";
import {
  type CampaignCard,
  campaignRecap,
  toCampaignCard,
} from "@/lib/strategy/campaign-card";

export type LoadStrategyResult =
  | { ok: true; strategy: Strategy; name: string; status: string }
  | { ok: false; error: string };

/**
 * Load a previously-saved strategy so the user can review and refine it.
 * Authorizes that the strategy belongs to the caller's active brand, then
 * validates the stored `structured` JSON against the current schema.
 *
 * `requireBrand()` runs OUTSIDE the try/catch on purpose: it may `redirect()`,
 * which works by throwing NEXT_REDIRECT — catching that would break auth.
 */
export async function loadStrategy(
  strategyId: string,
): Promise<LoadStrategyResult> {
  const { brand } = await requireBrand();
  try {
    const row = await getStrategyById(strategyId);
    // Same generic message whether it's missing or belongs to another brand,
    // so we don't leak which strategy ids exist.
    if (!row || row.brandId !== brand.id) {
      return { ok: false, error: "Strategy not found." };
    }
    const parsed = strategySchema.safeParse(row.structured);
    if (!parsed.success) {
      return { ok: false, error: "This strategy could not be loaded." };
    }
    return {
      ok: true,
      strategy: parsed.data,
      name: row.name,
      status: row.status,
    };
  } catch (err) {
    console.error("loadStrategy failed", err);
    return { ok: false, error: "Could not load strategy." };
  }
}

/**
 * Commit a campaign: the chat's strategy card moves from draft to saved, and
 * every earlier version in the same chat is archived so exactly one campaign
 * stands per chat.
 *
 * Server actions are reachable POST endpoints, so this authorizes exactly like
 * loadStrategy: resolve the caller's brand first, then refuse any strategy
 * that isn't theirs. `requireBrand()` stays outside the try/catch because it
 * signals via a thrown NEXT_REDIRECT.
 */
export async function saveStrategy(
  strategyId: string,
): Promise<
  { ok: true; card: CampaignCard | null } | { ok: false; error: string }
> {
  const { dbUser, brand } = await requireBrand();
  try {
    const row = await getStrategyById(strategyId);
    if (!row || row.brandId !== brand.id) {
      return { ok: false, error: "Strategy not found." };
    }
    const saved = await updateStrategy(strategyId, { status: "active" });
    if (row.conversationId) {
      await archiveSupersededStrategies(row.conversationId, strategyId);
    }
    await captureServerEvent({
      distinctId: dbUser.id,
      event: "strategy_saved",
      properties: {
        brand_id: brand.id,
        strategy_id: strategyId,
        conversation_id: row.conversationId,
      },
    });
    return { ok: true, card: toCampaignCard(saved ?? row) };
  } catch (err) {
    console.error("saveStrategy failed", err);
    return { ok: false, error: "Could not save strategy." };
  }
}

/**
 * Review: post the campaign recap into its chat as a real assistant message.
 * Persisted rather than injected client-side, so the user's next refinement
 * turn still has the campaign above it when the chat is reopened.
 */
export async function addStrategyRecap(
  strategyId: string,
): Promise<
  { ok: true; id: string; text: string } | { ok: false; error: string }
> {
  const { brand } = await requireBrand();
  try {
    const row = await getStrategyById(strategyId);
    if (!row || row.brandId !== brand.id) {
      return { ok: false, error: "Strategy not found." };
    }
    if (!row.conversationId) {
      return { ok: false, error: "This strategy isn't attached to a chat." };
    }
    const parsed = strategySchema.safeParse(row.structured);
    if (!parsed.success) {
      return { ok: false, error: "This strategy could not be loaded." };
    }
    const text = campaignRecap(parsed.data);
    const message = await createMessage({
      conversationId: row.conversationId,
      role: "assistant",
      content: text,
    });
    await touchConversation(row.conversationId);
    return { ok: true, id: message.id, text };
  } catch (err) {
    console.error("addStrategyRecap failed", err);
    return { ok: false, error: "Could not open this strategy for review." };
  }
}
