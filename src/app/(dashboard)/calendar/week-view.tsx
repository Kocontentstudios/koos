"use client";

import { Plus } from "lucide-react";
import { dayKey, groupItemsByDay, weekDays } from "@/lib/calendar/group";
import { formatLongDate, formatWeekdayShort } from "@/lib/calendar/labels";
import { cn } from "@/lib/utils";
import { CalendarItemCard } from "./calendar-item-card";
import type { CalendarItem } from "./types";

interface WeekViewProps {
  focused: Date;
  items: CalendarItem[];
  today: Date;
  onSelect: (item: CalendarItem) => void;
  onAddDay: (day: Date) => void;
}

export function WeekView({
  focused,
  items,
  today,
  onSelect,
  onAddDay,
}: WeekViewProps) {
  const days = weekDays(focused);
  const byDay = groupItemsByDay(items);
  const todayKey = dayKey(today);

  return (
    // One bordered, rounded, overflow-hidden grid (template app.css ~71–108).
    // The container background bleeds through the 1px gaps to form hairline
    // column dividers on desktop; on mobile the 7 columns stack into one.
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)]">
      <div className="grid grid-cols-1 gap-px sm:grid-cols-7">
        {days.map((day) => {
          const key = dayKey(day);
          const dayItems = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <div key={key} className="flex flex-col bg-[var(--background)]">
              <div className="group relative border-b border-[var(--border)] bg-surface-1 px-3 py-3 text-center">
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  {formatWeekdayShort(day)}
                </div>
                <div
                  className={cn(
                    "mt-1 text-lg font-semibold",
                    isToday ? "text-primary" : "text-foreground",
                  )}
                >
                  {day.getUTCDate()}
                </div>
                <button
                  type="button"
                  onClick={() => onAddDay(day)}
                  aria-label={`Add post on ${formatLongDate(day)}`}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] transition-opacity duration-150 hover:bg-[rgba(19,139,200,0.15)] hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)] opacity-60 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 focus-visible:opacity-100"
                >
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex flex-col gap-2 p-2 sm:min-h-[400px]">
                {dayItems.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-[var(--text-muted)]">
                    No items
                  </p>
                ) : (
                  dayItems.map((item) => (
                    <CalendarItemCard
                      key={item.id}
                      item={item}
                      onSelect={onSelect}
                      compact
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
