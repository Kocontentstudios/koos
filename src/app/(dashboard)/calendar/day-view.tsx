"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dayKey, groupItemsByDay } from "@/lib/calendar/group";
import { CalendarItemCard } from "./calendar-item-card";
import type { CalendarItem } from "./types";

interface DayViewProps {
  focused: Date;
  items: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
  onAddDay: (day: Date) => void;
}

export function DayView({ focused, items, onSelect, onAddDay }: DayViewProps) {
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
      <Button
        variant="secondary"
        size="lg"
        className="w-full gap-1.5"
        onClick={() => onAddDay(focused)}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        Add post
      </Button>
    </div>
  );
}
