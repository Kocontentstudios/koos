"use client";

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

interface MonthViewProps {
  focused: Date;
  items: CalendarItem[];
  today: Date;
  /** Switches to Day view focused on the clicked day. */
  onSelectDay: (day: Date) => void;
}

export function MonthView({
  focused,
  items,
  today,
  onSelectDay,
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
          return (
            <button
              type="button"
              key={key}
              onClick={() => onSelectDay(day)}
              aria-label={`View ${day.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              })}`}
              className={cn(
                "flex min-h-[64px] flex-col gap-1 border-b border-r border-[var(--border)] p-1.5 text-left transition-colors duration-150 hover:bg-[rgba(19,139,200,0.06)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)] sm:min-h-[96px]",
                !inMonth && "opacity-40",
              )}
            >
              <span
                className={cn(
                  "text-[12px] font-semibold",
                  isToday
                    ? "inline-flex h-[22px] w-[22px] items-center justify-center self-start rounded-full bg-primary text-white"
                    : "text-foreground",
                )}
              >
                {day.getUTCDate()}
              </span>
              <div className="flex flex-col gap-1">
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
                    <span className="truncate">{item.title}</span>
                  </span>
                ))}
                {dayItems.length > MAX_CHIPS && (
                  <span className="px-1.5 text-[10px] text-[var(--text-muted)]">
                    +{dayItems.length - MAX_CHIPS} more
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
