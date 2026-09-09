"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { addDays, dayKey, weekDays } from "@/lib/calendar/group";
import {
  formatLongDate,
  formatMonthLabel,
  formatWeekRangeLabel,
} from "@/lib/calendar/labels";
import { AddItemDrawer } from "./add-item-drawer";
import { AgendaView } from "./agenda-view";
import { CalendarItemDrawer } from "./calendar-item-drawer";
import { DayView } from "./day-view";
import { resolveFocusedDate } from "./focused-date";
import { MonthView } from "./month-view";
import { PickDesignBanner } from "./pick-design-banner";
import { resolvePickGuidance } from "./pick-guidance";
import { RequestDesignModal } from "./request-design-modal";
import {
  type BrandSummary,
  type CalendarItem,
  type CalendarOption,
  type CalendarView,
  type SerializedCalendar,
  type SerializedItem,
  VIEWS,
} from "./types";
import { ViewToggle } from "./view-toggle";
import { WeekView } from "./week-view";

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
  /** Arrived from the Design Tickets chooser to pick an item to request. */
  pickMode: boolean;
}

export function CalendarClient({
  calendar,
  items,
  brand,
  campaignName,
  submittedItemIds,
  calendarOptions,
  pickMode,
}: CalendarClientProps) {
  const submittedSet = useMemo(
    () => new Set(submittedItemIds),
    [submittedItemIds],
  );
  const parsedItems = useMemo<CalendarItem[]>(
    () => items.map((it) => ({ ...it, date: new Date(it.date) })),
    [items],
  );

  const today = useMemo(utcToday, []);

  /*
   * Land on today when the calendar covers it, otherwise on the start. Keying
   * purely off `startDate` used to mean a single entry placed far in the past
   * dragged the window back and every later visit opened on an empty month —
   * widening is one-directional, so nothing walked that back.
   */
  const defaultDate = useMemo(() => {
    const start = new Date(calendar.startDate);
    const end = new Date(calendar.endDate);
    const covered =
      today.getTime() >= start.getTime() && today.getTime() <= end.getTime();
    return dayKey(covered ? today : start);
  }, [calendar.startDate, calendar.endDate, today]);

  // URL state: ?view=… & ?date=YYYY-MM-DD — shareable / back-button friendly.
  const [view, setView] = useQueryState(
    "view",
    parseAsStringLiteral(VIEWS).withDefault("month"),
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

  const focused = useMemo(
    () => resolveFocusedDate(dateKey, defaultDate),
    [dateKey, defaultDate],
  );

  // Track the selected item by id and re-derive it from the freshest props,
  // so an edit + router.refresh() updates the open drawer's contents.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => parsedItems.find((it) => it.id === selectedId) ?? null,
    [parsedItems, selectedId],
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState<Date | null>(null);

  function openItem(item: CalendarItem) {
    setSelectedId(item.id);
    setDrawerOpen(true);
  }

  function openAdd(day: Date) {
    setAddDate(day);
    setAddOpen(true);
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

  /* The banner must only ask for what the CURRENT view allows: month renders
     items as non-interactive chips, week/day show one window, and agenda hides
     everything before the focused date. */
  const pickGuidance = useMemo(
    () => resolvePickGuidance(view, parsedItems, focused, submittedSet),
    [view, parsedItems, focused, submittedSet],
  );

  return (
    <div className="flex flex-col gap-4">
      {pickMode && <PickDesignBanner guidance={pickGuidance} />}
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
          <Button
            variant="default"
            size="sm"
            className="gap-1.5"
            onClick={() => openAdd(focused)}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            New post
          </Button>
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
          onAddDay={openAdd}
        />
      )}
      {view === "week" && (
        <WeekView
          focused={focused}
          items={parsedItems}
          today={today}
          onSelect={openItem}
          onAddDay={openAdd}
        />
      )}
      {view === "day" && (
        <DayView
          focused={focused}
          items={parsedItems}
          onSelect={openItem}
          onAddDay={openAdd}
        />
      )}
      {view === "agenda" && (
        <AgendaView focused={focused} items={parsedItems} onSelect={openItem} />
      )}

      <CalendarItemDrawer
        item={selected}
        brandId={brand.id}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        submitted={selected ? submittedSet.has(selected.id) : false}
        onRequestDesign={openRequestDesign}
      />

      <AddItemDrawer
        calendarId={calendar.id}
        date={addDate}
        open={addOpen}
        onOpenChange={setAddOpen}
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
