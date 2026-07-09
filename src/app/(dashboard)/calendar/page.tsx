import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireBrand } from "@/lib/auth/require-brand";
import {
  getCalendarItems,
  getCalendarsForBrand,
  getDesignTicketsByUser,
  getStrategyById,
} from "@/lib/db/queries";
import { isUuid } from "@/lib/validation/uuid";
import { CalendarClient } from "./calendar-client";
import type {
  BrandSummary,
  CalendarOption,
  SerializedCalendar,
  SerializedItem,
} from "./types";

function calendarRangeLabel(startDate: Date, endDate: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ calendarId?: string }>;
}) {
  const { dbUser, brand } = await requireBrand();
  const { calendarId } = await searchParams;

  // All calendars for the brand (newest first); the URL may pin a specific
  // one, otherwise fall back to the latest. Non-owned ids simply don't match.
  const brandCalendars = await getCalendarsForBrand(brand.id);
  const selected =
    (calendarId && isUuid(calendarId)
      ? brandCalendars.find((c) => c.calendar.id === calendarId)
      : undefined) ?? brandCalendars[0];
  const calendar = selected?.calendar ?? null;

  if (!calendar) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(19,139,200,0.2)] text-xl font-bold text-primary">
          K
        </div>
        <h1 className="mb-2 font-display text-2xl font-bold text-foreground">
          No calendar yet
        </h1>
        <p className="mb-6 max-w-md text-[15px] text-[var(--text-secondary)]">
          Generate a content strategy first — your calendar is built from it.
        </p>
        <Link href="/strategy">
          <Button variant="default" size="lg">
            Go to Strategy
          </Button>
        </Link>
      </div>
    );
  }

  const [items, strategy, userTickets] = await Promise.all([
    getCalendarItems(calendar.id),
    getStrategyById(calendar.strategyId),
    getDesignTicketsByUser(dbUser.id),
  ]);

  const brandSummary: BrandSummary = {
    id: brand.id,
    name: brand.name,
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor,
    logoUrl: brand.logoUrl,
  };

  // Calendar items that already have a design ticket → "submitted" state.
  const submittedItemIds = userTickets
    .map((t) => t.ticket.calendarItemId)
    .filter((id): id is string => id !== null);

  // Dates are serialized to ISO strings so props are plainly serializable
  // across the server→client boundary; the client re-parses to UTC Dates.
  const serializedCalendar: SerializedCalendar = {
    id: calendar.id,
    startDate: calendar.startDate.toISOString(),
    endDate: calendar.endDate.toISOString(),
  };

  const serializedItems: SerializedItem[] = items.map((it) => ({
    id: it.id,
    date: it.date.toISOString(),
    time: it.time,
    platform: it.platform,
    contentType: it.contentType,
    title: it.title,
    brief: it.brief,
    designRequired: it.designRequired,
    designType: it.designType,
    dimensions: it.dimensions,
    status: it.status,
  }));

  // Picker options across every strategy's calendar, newest first.
  const calendarOptions: CalendarOption[] = brandCalendars.map((c) => ({
    id: c.calendar.id,
    label: `${c.strategyName} · ${calendarRangeLabel(c.calendar.startDate, c.calendar.endDate)}`,
  }));

  return (
    <CalendarClient
      calendar={serializedCalendar}
      items={serializedItems}
      brand={brandSummary}
      campaignName={strategy?.name ?? null}
      submittedItemIds={submittedItemIds}
      calendarOptions={calendarOptions}
    />
  );
}
