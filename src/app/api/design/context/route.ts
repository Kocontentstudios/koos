import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  getBrandAssets,
  getStrategiesByBrand,
  listCalendarItemsForBrand,
  listDesignBriefsForBrand,
  listDesignTicketsForBrand,
} from "@/lib/db/queries";
import type { ContextOption } from "@/lib/design/context-search";
import { formatTicketNumber } from "@/lib/design/ticket";
import { isUuid } from "@/lib/validation/uuid";

/** Kept modest: the picker filters client-side, so this only has to cover what
 *  a user could plausibly scroll to rather than the brand's whole history. */
const PER_TYPE_LIMIT = 40;

/* Briefs and calendar items are what the picker EXISTS to attach, and the
   reported bug was exactly that they were being cut. They get room for a real
   brand's history rather than the modest per-type cap the other lists use. */
const BRIEF_LIMIT = 500;
const CALENDAR_ITEM_LIMIT = 500;

function shorten(text: string | null | undefined, max = 80): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Everything on this brand the Design Studio picker can attach.
 *
 * One request rather than five, so opening the picker is a single round trip.
 * Every list is already scoped to the brand by its query, and access to that
 * brand is checked before any of them run.
 */
export async function GET(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId || !isUuid(brandId)) {
    return Response.json(
      { error: "Missing or invalid brandId" },
      { status: 400 },
    );
  }

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  const [briefs, tickets, strategies, assets, items] = await Promise.all([
    listDesignBriefsForBrand(brandId, BRIEF_LIMIT),
    listDesignTicketsForBrand(brandId),
    getStrategiesByBrand(brandId),
    getBrandAssets(brandId),
    /* Every calendar, not just the newest. Reading only calendars[0] made a
       brief saved against any older campaign unreachable from the picker, so
       users copied briefs by hand (KOOS-BUG-016). They are grouped by
       calendar client-side rather than dropped here. */
    listCalendarItemsForBrand(brandId, CALENDAR_ITEM_LIMIT),
  ]);

  const options: ContextOption[] = [
    ...briefs.map((b) => ({
      type: "brief" as const,
      id: b.id,
      label: b.title,
      hint: shorten(b.designType),
    })),
    ...items.map((i) => ({
      type: "calendar_item" as const,
      id: i.id,
      label: i.title,
      hint: shorten(
        [i.platform, i.date?.toISOString().slice(0, 10)]
          .filter(Boolean)
          .join(" · "),
      ),
      /* Carried so the picker can group by campaign. The strategy's name is
         what a user recognises; a calendar has no name of its own. */
      groupId: i.calendarId,
      groupLabel: i.strategyName,
    })),
    ...tickets.slice(0, PER_TYPE_LIMIT).map((t) => ({
      type: "ticket" as const,
      id: t.id,
      label: t.title ?? formatTicketNumber(t.ticketNumber),
      hint: shorten(t.designType),
    })),
    ...strategies.slice(0, PER_TYPE_LIMIT).map((s) => ({
      type: "strategy" as const,
      id: s.id,
      label: s.name,
      hint: shorten(s.status),
    })),
    ...assets.slice(0, PER_TYPE_LIMIT).map((a) => ({
      type: "asset" as const,
      id: a.id,
      label: a.fileName,
      hint: shorten(a.assetType),
    })),
  ];

  return Response.json({ options });
}
