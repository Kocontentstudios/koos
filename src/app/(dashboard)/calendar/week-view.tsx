"use client";

import { dayKey, groupItemsByDay, weekDays } from "@/lib/calendar/group";
import { formatWeekdayShort } from "@/lib/calendar/labels";
import { cn } from "@/lib/utils";
import { CalendarItemCard } from "./calendar-item-card";
import type { CalendarItem } from "./types";

interface WeekViewProps {
  focused: Date;
  items: CalendarItem[];
  today: Date;
  onSelect: (item: CalendarItem) => void;
}

export function WeekView({ focused, items, today, onSelect }: WeekViewProps) {
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
              <div className="border-b border-[var(--border)] bg-surface-1 px-3 py-3 text-center">
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
