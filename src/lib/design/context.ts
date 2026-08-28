import type { AspectRatio } from "@/lib/ai/image/types";
import {
  getBrandAssets,
  getBrandById,
  getCalendarItemForBrand,
  getDesignBriefById,
  getDesignTicketById,
  getStrategyById,
} from "@/lib/db/queries";
import type { brands } from "@/lib/db/schema";
import { aspectRatioFromDimensions } from "@/lib/design/aspect-ratio";
import {
  type AttachmentRef,
  mergeAttachments,
  type ResolvedAttachment,
  sortByPrecedence,
} from "@/lib/design/attachments";
import { formatTicketNumber } from "@/lib/design/ticket";
import { type BrandSummary, brandSummaryFrom } from "@/lib/jobs/brand-summary";
import { toCampaignCard } from "@/lib/strategy/campaign-card";

type BrandRow = typeof brands.$inferSelect;

export { aspectRatioFromDimensions };

export type DesignContextSource =
  | "chat_brief"
  | "calendar_item"
  | "quick"
  | "brand";

/** Everything the spec builder needs, gathered from whichever surface the user
 * started on. Entry points pass ids, never re-collected text — this is the
 * whole reason a user never retypes what the system already knows. */
export interface DesignContext {
  source: DesignContextSource;
  brand: BrandRow;
  brandSummary: BrandSummary;
  briefId: string | null;
  calendarItemId: string | null;
  /** Everything the user attached, in precedence order — the provenance of
   *  this generation, recorded so it can be answered for later. */
  attachments: { type: string; id: string; label: string }[];
  title: string | null;
  /** Brief markdown, calendar item brief, or the user's free-form ask. */
  briefText: string | null;
  designType: string | null;
  dimensions: string | null;
  aspectRatio: AspectRatio;
  platform: string | null;
  scheduledFor: string | null;
  /** Attached images the renderer should feed the model as references. */
  referenceUrls: string[];
}

export interface ResolveDesignContextArgs {
  brandId: string;
  /** Back-compat: the calendar and chat entry points still send bare ids. */
  briefId?: string | null;
  calendarItemId?: string | null;
  attachments?: AttachmentRef[];
  freeform?: string | null;
  aspectRatio?: AspectRatio | null;
}

export class DesignContextError extends Error {}

/** Cap on how much of one attachment reaches the model, so a long strategy
 *  cannot crowd out everything else the user attached. */
const MAX_ATTACHMENT_CHARS = 4000;

function clamp(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_ATTACHMENT_CHARS
    ? `${trimmed.slice(0, MAX_ATTACHMENT_CHARS)}…`
    : trimmed;
}

/**
 * Loads one attachment and proves it belongs to this brand.
 *
 * Every branch re-checks ownership against `brandId`. The ids arrive from the
 * client, so without this a user could attach another brand's brief, calendar
 * item or ticket and read its contents back out of the generated design.
 */
async function loadAttachment(
  ref: AttachmentRef,
  brandId: string,
): Promise<ResolvedAttachment> {
  switch (ref.type) {
    case "brief": {
      const brief = await getDesignBriefById(ref.id);
      if (!brief || brief.brandId !== brandId) {
        throw new DesignContextError("Design brief not found.");
      }
      return {
        type: "brief",
        id: brief.id,
        label: brief.title,
        text: clamp(brief.briefMarkdown),
        designType: brief.designType,
        dimensions: brief.dimensions,
      };
    }
    case "calendar_item": {
      // Scoped by brand in SQL: calendar_items reaches its brand only through
      // calendars, so the row alone cannot be checked here.
      const item = await getCalendarItemForBrand(ref.id, brandId);
      if (!item) throw new DesignContextError("Calendar item not found.");
      return {
        type: "calendar_item",
        id: item.id,
        label: item.title,
        /* A manually added entry has no brief by construction (the add form
           hides it), so falling straight through to the title would brief the
           model on a headline and silently drop the copy the user wrote. */
        text: clamp(item.brief ?? item.caption ?? item.title),
        designType: item.designType ?? item.contentType,
        dimensions: item.dimensions,
        platform: item.platform,
        scheduledFor: item.date ? item.date.toISOString().slice(0, 10) : null,
      };
    }
    case "ticket": {
      const ticket = await getDesignTicketById(ref.id);
      if (!ticket || ticket.brandId !== brandId) {
        throw new DesignContextError("Design request not found.");
      }
      return {
        type: "ticket",
        id: ticket.id,
        label: ticket.title ?? formatTicketNumber(ticket.ticketNumber),
        text: clamp([ticket.brief, ticket.notes].filter(Boolean).join("\n\n")),
        designType: ticket.designType,
        dimensions: ticket.dimensions,
      };
    }
    case "strategy": {
      const strategy = await getStrategyById(ref.id);
      if (!strategy || strategy.brandId !== brandId) {
        throw new DesignContextError("Campaign strategy not found.");
      }
      const card = toCampaignCard(strategy);
      return {
        type: "strategy",
        id: strategy.id,
        label: strategy.name,
        /* The stored structure is large and mostly scheduling detail. Only the
           campaign framing helps a design; the rest is noise to the model. */
        text: clamp(
          card
            ? [
                `Campaign: ${card.campaignName}`,
                `Objective: ${card.objective}`,
                card.channels.length > 0
                  ? `Channels: ${card.channels.join(", ")}`
                  : null,
                card.timelineSpan ? `Timeline: ${card.timelineSpan}` : null,
              ]
                .filter(Boolean)
                .join("\n")
            : strategy.name,
        ),
      };
    }
    case "asset": {
      const assets = await getBrandAssets(brandId);
      const asset = assets.find((a) => a.id === ref.id);
      if (!asset) throw new DesignContextError("Brand asset not found.");
      return {
        type: "asset",
        id: asset.id,
        label: asset.fileName,
        text: null,
        fileUrl: asset.fileUrl,
      };
    }
  }
}

/** Which DesignContext source a set of attachments reports as its primary. */
function sourceFor(
  attachments: ResolvedAttachment[],
  freeform: string | null | undefined,
): DesignContextSource {
  const primary = sortByPrecedence(attachments)[0];
  if (primary?.type === "brief") return "chat_brief";
  if (primary?.type === "calendar_item") return "calendar_item";
  if (primary) return "quick";
  return freeform ? "quick" : "brand";
}

/** Resolves ids into the full generation context. Brand access must already
 * have been checked by the caller — this only reads. */
export async function resolveDesignContext({
  brandId,
  briefId,
  calendarItemId,
  attachments,
  freeform,
  aspectRatio,
}: ResolveDesignContextArgs): Promise<DesignContext> {
  const brand = await getBrandById(brandId);
  if (!brand) throw new DesignContextError("Brand not found.");

  // Bare ids from the older entry points become attachments, deduped so
  // sending both forms of the same thing does not brief the model twice.
  const refs: AttachmentRef[] = [
    ...(briefId ? [{ type: "brief" as const, id: briefId }] : []),
    ...(calendarItemId
      ? [{ type: "calendar_item" as const, id: calendarItemId }]
      : []),
    ...(attachments ?? []),
  ].filter(
    (ref, i, all) =>
      all.findIndex((o) => o.type === ref.type && o.id === ref.id) === i,
  );

  const resolved = await Promise.all(
    refs.map((ref) => loadAttachment(ref, brandId)),
  );
  const merged = mergeAttachments({
    freeform,
    attachments: resolved,
    aspectRatio,
  });

  return {
    brand,
    brandSummary: brandSummaryFrom(brand),
    source: sourceFor(resolved, freeform),
    // Kept for the columns that still record a single primary id.
    briefId: resolved.find((a) => a.type === "brief")?.id ?? null,
    calendarItemId:
      resolved.find((a) => a.type === "calendar_item")?.id ?? null,
    attachments: resolved.map(({ type, id, label }) => ({ type, id, label })),
    title: merged.title,
    briefText: merged.briefText,
    designType: merged.designType,
    dimensions: merged.dimensions,
    aspectRatio: merged.aspectRatio,
    platform: merged.platform,
    scheduledFor: merged.scheduledFor,
    referenceUrls: merged.referenceUrls,
  };
}
