"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface TrendBar {
  key: string;
  count: number;
  /** Height as a percentage of the tallest bar. */
  percent: number;
  /** The whole sentence, built server-side by tooltipText. */
  tooltip: string;
}

/**
 * The activity chart (ADMIN-BUG-003).
 *
 * A client island rather than a client page: the tooltip needs hover and focus
 * state, nothing else on /admin/analytics does.
 *
 * Each bar is a real <button>, not a div with a `title`. The native attribute
 * it replaces was mouse-only — it never appeared on keyboard focus and was not
 * exposed as an accessible name — so the chart's numbers were unreachable
 * without a pointer. The button carries the same sentence as aria-label, so
 * the tooltip is a visual convenience rather than the only way to read it.
 */
export function TrendChart({ bars }: { bars: TrendBar[] }) {
  return (
    <div className="flex h-32 items-end gap-1">
      {bars.map((bar) => (
        <Tooltip key={bar.key}>
          <TooltipTrigger
            type="button"
            aria-label={bar.tooltip}
            data-trend-bar=""
            className="group flex h-full flex-1 cursor-default flex-col items-center justify-end gap-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            <span className="text-[11px] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
              {bar.count}
            </span>
            <span
              className="w-full rounded-t bg-primary"
              /* A zero bar still gets a hairline so the period reads as
                 measured-and-empty rather than missing. */
              style={{
                height: `${Math.max(bar.percent, bar.count > 0 ? 2 : 0)}%`,
              }}
            />
          </TooltipTrigger>
          <TooltipContent>{bar.tooltip}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
