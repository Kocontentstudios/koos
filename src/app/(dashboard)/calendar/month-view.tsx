"use client";

import { Pencil, Plus } from "lucide-react";
import {
  dayKey,
  groupItemsByDay,
  isSameMonth,
  monthMatrixSunday,
} from "@/lib/calendar/group";
import { cn } from "@/lib/utils";
import type { CalendarItem } from "./types";

// Sunday-start columns, matching the design template's month view.
const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 2;

function longDayLabel(day: Date): string {
  return day.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface MonthViewProps {
  focused: Date;
  items: CalendarItem[];
  today: Date;
  /** Switches to Day view focused on the clicked day. */
  onSelectDay: (day: Date) => void;
  /** Opens the add drawer seeded with this day. */
  onAddDay: (day: Date) => void;
}

export function MonthView({
  focused,
  items,
  today,
  onSelectDay,
  onAddDay,
}: MonthViewProps) {
  const weeks = monthMatrixSunday(focused);
  const byDay = groupItemsByDay(items);
  const todayKey = dayKey(today);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)]">
      <div className="grid grid-cols-7 border-b border-[var(--border)] bg-surface-1/40">
        {WEEKDAY_HEADERS.map((label) => (
          <div
            key={label}
            className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]"
          >
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label.charAt(0)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((day) => {
          const key = dayKey(day);
          const dayItems = byDay.get(key) ?? [];
          const inMonth = isSameMonth(day, focused);
          const isToday = key === todayKey;
          const label = longDayLabel(day);
          return (
            // The cell hosts two buttons (drill in, add), so it cannot itself
            // be a button — the drill target is a full-bleed overlay instead.
            <div
              key={key}
              className={cn(
                "group relative flex min-h-[64px] flex-col gap-1 border-b border-r border-[var(--border)] p-1.5 sm:min-h-[96px]",
                !inMonth && "opacity-40",
              )}
            >
              <button
                type="button"
                onClick={() => onSelectDay(day)}
                aria-label={`View ${label}`}
                className="absolute inset-0 z-0 transition-colors duration-150 hover:bg-[rgba(19,139,200,0.06)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[var(--accent-glow)]"
              />
              <button
                type="button"
                onClick={() => onAddDay(day)}
                aria-label={`Add post on ${label}`}
                // Hidden-at-rest is gated on (hover: hover), not on a width
                // breakpoint: a tablet is wide but cannot hover, and an
                // opacity-0 button there is an invisible tap target.
                className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] transition-opacity duration-150 hover:bg-[rgba(19,139,200,0.15)] hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)] opacity-60 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 focus-visible:opacity-100"
              >
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              </button>

              {/* Content sits above the overlay but stays click-through, so
                  the whole cell still reads as one drill-in target. */}
              <span
                className={cn(
                  "pointer-events-none relative z-[1] text-[12px] font-semibold",
                  isToday
                    ? "inline-flex h-[22px] w-[22px] items-center justify-center self-start rounded-full bg-primary text-white"
                    : "text-foreground",
                )}
              >
                {day.getUTCDate()}
              </span>
              <div className="pointer-events-none relative z-[1] flex flex-col gap-1">
                {dayItems.slice(0, MAX_CHIPS).map((item) => (
                  <span
                    key={item.id}
                    className="flex items-center gap-1 truncate rounded border border-[var(--border)] border-l-2 border-l-primary bg-surface-1 px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
                  >
                    {item.designRequired && (
                      <span
                        aria-hidden="true"
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                      />
                    )}
                    {item.source === "manual" && (
                      <Pencil
                        aria-label="Added by you"
                        className="h-2.5 w-2.5 shrink-0 text-[var(--text-muted)]"
                      />
                    )}
                    <span className="truncate">{item.title}</span>
                  </span>
                ))}
                {dayItems.length > MAX_CHIPS && (
                  <span className="px-1.5 text-[10px] text-[var(--text-muted)]">
                    +{dayItems.length - MAX_CHIPS} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
