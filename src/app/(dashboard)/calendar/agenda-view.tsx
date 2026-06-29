"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { groupItemsByDay } from "@/lib/calendar/group";
import { formatLongDate, itemsFrom } from "@/lib/calendar/labels";
import type { CalendarItem } from "./types";
import { statusLabel } from "./types";

interface AgendaViewProps {
  focused: Date;
  items: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
}

export function AgendaView({ focused, items, onSelect }: AgendaViewProps) {
  const upcoming = itemsFrom(items, focused);
  const byDay = groupItemsByDay(upcoming);

  if (upcoming.length === 0) {
    return (
      <p className="mx-auto max-w-[720px] rounded-xl border border-[var(--border)] bg-surface-1/40 px-4 py-8 text-center text-sm text-[var(--text-muted)]">
        Nothing scheduled from here on.
      </p>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[720px]">
      {[...byDay.entries()].map(([key, dayItems]) => (
        <section key={key} className="mb-4">
          <h2 className="mb-2.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {formatLongDate(dayItems[0].date)}
          </h2>
          <div className="flex flex-col gap-2">
            {dayItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item)}
                aria-label={`Open ${item.title}`}
                className="flex items-center gap-4 rounded-[10px] border border-[var(--border)] bg-surface-1 px-4 py-3.5 text-left transition-colors duration-150 hover:border-[var(--border-accent)] hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)]"
              >
                <span className="w-[70px] shrink-0 text-[12px] text-[var(--text-muted)]">
                  {item.time ?? "—"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {item.title}
                  </span>
                  <span className="block truncate text-[12px] text-[var(--text-muted)]">
                    {item.platform} · {item.contentType}
                  </span>
                </span>
                <StatusBadge status={item.status} className="shrink-0">
                  {statusLabel(item.status)}
                </StatusBadge>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
