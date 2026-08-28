import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  getBrandAssets,
  getCalendarItems,
  getCalendarsForBrand,
  getStrategiesByBrand,
  listDesignBriefsForBrand,
  listDesignTicketsForBrand,
} from "@/lib/db/queries";
import type { ContextOption } from "@/lib/design/context-search";
import { formatTicketNumber } from "@/lib/design/ticket";
import { isUuid } from "@/lib/validation/uuid";

/** Kept modest: the picker filters client-side, so this only has to cover what
 *  a user could plausibly scroll to rather than the brand's whole history. */
const PER_TYPE_LIMIT = 40;

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

  const [briefs, tickets, strategies, assets, calendars] = await Promise.all([
    listDesignBriefsForBrand(brandId, PER_TYPE_LIMIT),
    listDesignTicketsForBrand(brandId),
    getStrategiesByBrand(brandId),
    getBrandAssets(brandId),
    getCalendarsForBrand(brandId),
  ]);

  // Calendar items hang off calendars, so the newest calendar is the one worth
  // offering; older ones are historical and would swamp the list.
  const items = calendars[0]
    ? await getCalendarItems(calendars[0].calendar.id)
    : [];

  const options: ContextOption[] = [
    ...briefs.map((b) => ({
      type: "brief" as const,
      id: b.id,
      label: b.title,
      hint: shorten(b.designType),
    })),
    ...items.slice(0, PER_TYPE_LIMIT).map((i) => ({
      type: "calendar_item" as const,
      id: i.id,
      label: i.title,
      hint: shorten(
        [i.platform, i.date?.toISOString().slice(0, 10)]
          .filter(Boolean)
          .join(" · "),
      ),
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
