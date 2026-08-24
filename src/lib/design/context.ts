import type { AspectRatio } from "@/lib/ai/image/types";
import {
  getBrandById,
  getCalendarItemById,
  getDesignBriefById,
} from "@/lib/db/queries";
import type { brands } from "@/lib/db/schema";
import { type BrandSummary, brandSummaryFrom } from "@/lib/jobs/brand-summary";

type BrandRow = typeof brands.$inferSelect;

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
  title: string | null;
  /** Brief markdown, calendar item brief, or the user's free-form ask. */
  briefText: string | null;
  designType: string | null;
  dimensions: string | null;
  aspectRatio: AspectRatio;
  platform: string | null;
  scheduledFor: string | null;
}

/** "1080x1350" → "4:5". Falls back to square when unparseable, since every
 * downstream renderer needs a concrete ratio. */
export function aspectRatioFromDimensions(
  dimensions: string | null | undefined,
): AspectRatio {
  const match = dimensions?.match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/i);
  if (!match) return "1:1";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return "1:1";
  const ratio = width / height;
  const candidates: [AspectRatio, number][] = [
    ["1:1", 1],
    ["4:5", 4 / 5],
    ["9:16", 9 / 16],
    ["16:9", 16 / 9],
  ];
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio)
      ? candidate
      : best,
  )[0];
}

export interface ResolveDesignContextArgs {
  brandId: string;
  briefId?: string | null;
  calendarItemId?: string | null;
  freeform?: string | null;
  aspectRatio?: AspectRatio | null;
}

export class DesignContextError extends Error {}

/** Resolves ids into the full generation context. Brand access must already
 * have been checked by the caller — this only reads. */
export async function resolveDesignContext({
  brandId,
  briefId,
  calendarItemId,
  freeform,
  aspectRatio,
}: ResolveDesignContextArgs): Promise<DesignContext> {
  const brand = await getBrandById(brandId);
  if (!brand) throw new DesignContextError("Brand not found.");

  const base = {
    brand,
    brandSummary: brandSummaryFrom(brand),
    briefId: briefId ?? null,
    calendarItemId: calendarItemId ?? null,
  };

  if (briefId) {
    const brief = await getDesignBriefById(briefId);
    if (!brief || brief.brandId !== brandId) {
      throw new DesignContextError("Design brief not found.");
    }
    return {
      ...base,
      source: "chat_brief",
      title: brief.title,
      briefText: brief.briefMarkdown,
      designType: brief.designType,
      dimensions: brief.dimensions,
      aspectRatio: aspectRatio ?? aspectRatioFromDimensions(brief.dimensions),
      platform: null,
      scheduledFor: null,
    };
  }

  if (calendarItemId) {
    const item = await getCalendarItemById(calendarItemId);
    if (!item) throw new DesignContextError("Calendar item not found.");
    return {
      ...base,
      source: "calendar_item",
      title: item.title,
      /* A manually added entry has no brief by construction (the add form
         hides it), so falling straight through to the title would brief the
         model on a headline and silently drop the copy the user wrote. */
      briefText: item.brief ?? item.caption ?? item.title,
      designType: item.designType ?? item.contentType,
      dimensions: item.dimensions,
      aspectRatio: aspectRatio ?? aspectRatioFromDimensions(item.dimensions),
      platform: item.platform,
      scheduledFor: item.date ? item.date.toISOString().slice(0, 10) : null,
    };
  }

  return {
    ...base,
    source: freeform ? "quick" : "brand",
    title: null,
    briefText: freeform ?? null,
    designType: null,
    dimensions: null,
    aspectRatio: aspectRatio ?? "1:1",
    platform: null,
    scheduledFor: null,
  };
}
