"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { addDays, dayKey, weekDays } from "@/lib/calendar/group";
import {
  formatLongDate,
  formatMonthLabel,
  formatWeekRangeLabel,
} from "@/lib/calendar/labels";
import { AgendaView } from "./agenda-view";
import { CalendarItemDrawer } from "./calendar-item-drawer";
import { DayView } from "./day-view";
import { MonthView } from "./month-view";
import { RequestDesignModal } from "./request-design-modal";
import type {
  BrandSummary,
  CalendarItem,
  CalendarOption,
  CalendarView,
  SerializedCalendar,
  SerializedItem,
} from "./types";
import { ViewToggle } from "./view-toggle";
import { WeekView } from "./week-view";

const VIEWS: CalendarView[] = ["month", "week", "day", "agenda"];

/** UTC midnight of the current day, for "today" highlighting. */
function utcToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

interface CalendarClientProps {
  calendar: SerializedCalendar;
  items: SerializedItem[];
  brand: BrandSummary;
  campaignName: string | null;
  submittedItemIds: string[];
  calendarOptions: CalendarOption[];
}

export function CalendarClient({
  calendar,
  items,
  brand,
  campaignName,
  submittedItemIds,
  calendarOptions,
}: CalendarClientProps) {
  const submittedSet = useMemo(
    () => new Set(submittedItemIds),
    [submittedItemIds],
  );
  const parsedItems = useMemo<CalendarItem[]>(
    () => items.map((it) => ({ ...it, date: new Date(it.date) })),
    [items],
  );

  // Default focused date = the calendar's start (the generation week has items).
  const defaultDate = useMemo(
    () => dayKey(new Date(calendar.startDate)),
    [calendar.startDate],
  );
  const today = useMemo(utcToday, []);

  // URL state: ?view=… & ?date=YYYY-MM-DD — shareable / back-button friendly.
  const [view, setView] = useQueryState(
    "view",
    parseAsStringLiteral(VIEWS).withDefault("week"),
  );
  const [dateKey, setDateKey] = useQueryState(
    "date",
    parseAsString.withDefault(defaultDate),
  );
  // ?calendarId= selects which strategy's calendar is shown. shallow:false so
  // the server component re-runs and loads the selected calendar's items.
  const [, setCalendarId] = useQueryState(
    "calendarId",
    parseAsString.withOptions({ shallow: false }),
  );

  function switchCalendar(id: string) {
    if (id === calendar.id) return;
    // Reset the focused date so the view lands on the new calendar's start.
    setDateKey(null);
    setCalendarId(id);
  }

  const focused = useMemo(() => new Date(`${dateKey}T00:00:00Z`), [dateKey]);

  // Track the selected item by id and re-derive it from the freshest props,
  // so an edit + router.refresh() updates the open drawer's contents.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => parsedItems.find((it) => it.id === selectedId) ?? null,
    [parsedItems, selectedId],
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  function openItem(item: CalendarItem) {
    setSelectedId(item.id);
    setDrawerOpen(true);
  }

  function openRequestDesign() {
    // Close the drawer and open the prefilled Request Design modal.
    setDrawerOpen(false);
    setRequestOpen(true);
  }

  function shift(direction: 1 | -1) {
    const step = view === "month" ? null : direction * 7;
    if (step === null) {
      // Move by one month, clamping the day so e.g. Jan 31 → Feb 28.
      const m = focused.getUTCMonth() + direction;
      const next = new Date(Date.UTC(focused.getUTCFullYear(), m, 1));
      setDateKey(dayKey(next));
    } else {
      setDateKey(dayKey(addDays(focused, step)));
    }
  }

  function goToday() {
    setDateKey(dayKey(today));
  }

  const label = useMemo(() => {
    if (view === "month") return formatMonthLabel(focused);
    if (view === "week") return formatWeekRangeLabel(weekDays(focused));
    if (view === "day") return formatLongDate(focused);
    return "Upcoming";
  }, [view, focused]);

  const showNav = view !== "agenda";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: strategy/calendar picker + view switcher (template calendar-header-left). */}
        <div className="flex flex-wrap items-center gap-3">
          {calendarOptions.length > 1 ? (
            <select
              value={calendar.id}
              onChange={(e) => switchCalendar(e.target.value)}
              aria-label="Switch strategy calendar"
              className="h-[38px] max-w-[280px] cursor-pointer truncate rounded-lg border border-[var(--border)] bg-surface-1 px-3 text-[13px] text-[var(--text-secondary)] outline-none transition-colors hover:border-[var(--border-accent)] focus-visible:border-primary"
            >
              {calendarOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            campaignName && (
              <span className="inline-flex items-center rounded-lg border border-[var(--border)] bg-surface-1 px-3.5 py-2 text-[13px] text-[var(--text-secondary)]">
                {campaignName}
              </span>
            )
          )}
          <ViewToggle value={view} onChange={(v) => setView(v)} />
        </div>

        {/* Right: range label + prev → Today → next (template calendar-header-right). */}
        <div className="flex items-center gap-2">
          <span className="mr-1 text-[13px] text-[var(--text-secondary)]">
            {label}
          </span>
          {showNav && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={
                  view === "month" ? "Previous month" : "Previous week"
                }
                onClick={() => shift(-1)}
                className="h-9 w-9 sm:h-7 sm:w-7"
              >
                <ChevronLeft />
              </Button>
              <Button variant="ghost" size="sm" onClick={goToday}>
                Today
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={view === "month" ? "Next month" : "Next week"}
                onClick={() => shift(1)}
                className="h-9 w-9 sm:h-7 sm:w-7"
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
      </header>

      {view === "month" && (
        <MonthView
          focused={focused}
          items={parsedItems}
          today={today}
          onSelectDay={(day) => {
            setDateKey(dayKey(day));
            setView("day");
          }}
        />
      )}
      {view === "week" && (
        <WeekView
          focused={focused}
          items={parsedItems}
          today={today}
          onSelect={openItem}
        />
      )}
      {view === "day" && (
        <DayView focused={focused} items={parsedItems} onSelect={openItem} />
      )}
      {view === "agenda" && (
        <AgendaView focused={focused} items={parsedItems} onSelect={openItem} />
      )}

      <CalendarItemDrawer
        item={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        submitted={selected ? submittedSet.has(selected.id) : false}
        onRequestDesign={openRequestDesign}
      />

      <RequestDesignModal
        open={requestOpen}
        onOpenChange={setRequestOpen}
        item={selected}
        brand={brand}
        campaignName={campaignName}
      />
    </div>
  );
}
