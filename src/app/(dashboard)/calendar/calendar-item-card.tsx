"use client";

import { cn } from "@/lib/utils";
import type { CalendarItem } from "./types";

interface CalendarItemCardProps {
  item: CalendarItem;
  onSelect: (item: CalendarItem) => void;
  /** Compact variant used inside dense week columns. */
  compact?: boolean;
}

export function CalendarItemCard({
  item,
  onSelect,
  compact = false,
}: CalendarItemCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      aria-label={`Open ${item.title}`}
      className={cn(
        "group flex w-full flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-surface-1 p-3 text-left transition-colors duration-150 hover:border-[var(--border-accent)] hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)]",
        compact && "p-3",
      )}
    >
      {item.time && (
        <span className="text-[11px] text-[var(--text-muted)]">
          {item.time}
        </span>
      )}
      <span className="text-[11px] text-[var(--text-secondary)]">
        {item.platform}
      </span>
      <p
        className={cn(
          "font-medium leading-snug text-foreground",
          compact ? "text-[13px] line-clamp-2" : "text-[13px]",
        )}
      >
        {item.title}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center rounded-full bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
          {item.contentType}
        </span>
        {item.designRequired && (
          <span className="inline-flex items-center rounded-full bg-[rgba(19,139,200,0.15)] px-2 py-0.5 text-[10px] font-medium text-[#85B7EB]">
            Design Required
          </span>
        )}
      </div>
    </button>
  );
}
