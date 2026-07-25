import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  getActiveCalendarForBrand,
  getAllBrandContexts,
  getBrandAssets,
  getBrandById,
  getBrandMemory,
  getCalendarItems,
  getConversationMessages,
  getRecentConversationsForBrand,
  getStrategiesByBrand,
  listDesignTicketsForBrand,
} from "@/lib/db/queries";
import { type ToolContext, withBrandAccess } from "./context";

export function buildReadTools(ctx: ToolContext): Record<string, Tool> {
  return {
    get_brand_profile: tool({
      description: "Get the active brand's profile fields and saved context sections.",
      inputSchema: z.object({}),
      execute: () =>
        withBrandAccess(ctx, async () => ({
          brand: await getBrandById(ctx.brandId),
          contexts: await getAllBrandContexts(ctx.brandId),
        })),
    }),
    list_brand_assets: tool({
      description: "List the brand's uploaded logos, images and documents.",
      inputSchema: z.object({}),
      execute: () => withBrandAccess(ctx, async () => ({ assets: await getBrandAssets(ctx.brandId) })),
    }),
    list_strategies: tool({
      description: "List the brand's marketing strategies with status.",
      inputSchema: z.object({}),
      execute: () => withBrandAccess(ctx, async () => ({ strategies: await getStrategiesByBrand(ctx.brandId) })),
    }),
    list_calendar_items: tool({
      description: "List content items on the brand's active calendar.",
      inputSchema: z.object({}),
      execute: () =>
        withBrandAccess(ctx, async () => {
          const cal = await getActiveCalendarForBrand(ctx.brandId);
          return { items: cal ? await getCalendarItems(cal.id) : [] };
        }),
    }),
    list_design_tickets: tool({
      description: "List the brand's design tickets and their status.",
      inputSchema: z.object({}),
      execute: () => withBrandAccess(ctx, async () => ({ tickets: await listDesignTicketsForBrand(ctx.brandId) })),
    }),
    recall_memory: tool({
      description: "Recall durable facts and the running summary remembered about this brand.",
      inputSchema: z.object({}),
      execute: () => withBrandAccess(ctx, async () => ({ memory: await getBrandMemory(ctx.brandId) })),
    }),
    list_past_conversations: tool({
      description: "List recent past conversations (titles + dates) for this brand.",
      inputSchema: z.object({}),
      execute: () =>
        withBrandAccess(ctx, async () => ({
          conversations: await getRecentConversationsForBrand(ctx.brandId, 20),
        })),
    }),
    read_conversation: tool({
      description: "Read the messages of one prior conversation by id.",
      inputSchema: z.object({ conversationId: z.string().uuid() }),
      execute: ({ conversationId }) =>
        withBrandAccess(ctx, async () => ({ messages: await getConversationMessages(conversationId) })),
    }),
  };
}
