"use client";

import { dayKey, groupItemsByDay } from "@/lib/calendar/group";
import { CalendarItemCard } from "./calendar-item-card";
import type { CalendarItem } from "./types";

interface DayViewProps {
  focused: Date;
  items: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
}

export function DayView({ focused, items, onSelect }: DayViewProps) {
  const dayItems = groupItemsByDay(items).get(dayKey(focused)) ?? [];

  return (
    // Template day view (app.css ~250–260): a single column of cards, max 640.
    // The date lives in the header range label, so no heading here.
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
      {dayItems.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-surface-1/40 px-4 py-8 text-center text-sm text-[var(--text-muted)]">
          No items scheduled for this day.
        </p>
      ) : (
        dayItems.map((item) => (
          <CalendarItemCard key={item.id} item={item} onSelect={onSelect} />
        ))
      )}
    </div>
  );
}
