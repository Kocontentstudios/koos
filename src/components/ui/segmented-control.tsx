"use client";

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  label: string;
  value: T;
}

/** Inline, not a `border-[…]` class: globals.css sets `border-color` on an
 * unlayered `*`, and unlayered CSS beats `@layer utilities`, so every border
 * utility on this track silently loses. Assert the computed value, never the
 * class name.
 *
 * --border-control rather than --border because the edge IS the grouping:
 * without one the segments read as loose floating labels. --border is
 * 1.09-1.23:1 and --border-accent 1.58-1.79:1; neither is a control boundary. */
const TRACK_BORDER = { borderColor: "var(--border-control)" } as const;

/* The selected segment is the page inverted (bg-foreground over text-background)
   rather than a surface token. --surface-1 and --surface-2 are both #ffffff in
   light mode, so the `bg-surface-2` chip this shipped with was white on white;
   even in dark mode it was 1.08:1 against the track, meaning the selection was
   carried by label colour alone, which is what WCAG 1.4.1 forbids. Inverting
   makes the difference luminance rather than hue, so it survives greyscale and
   every colour vision deficiency. Weight is the second, independent cue: it is
   the one that still works in forced-colors mode, where the OS replaces every
   background.

   The ::before copy reserves the bold measurement in both states so selecting a
   segment cannot reflow the row. It is a pseudo-element rather than a second
   span because generated content stays out of textContent — a duplicated text
   node makes every button read "MonthMonth" and breaks text-based queries.

   The focus ring is inset because the calendar consumer wraps this control in
   `overflow-x-auto`, and that scroll container clips an outward ring on the
   first and last segment. */
const SEGMENT =
  "grid place-items-center whitespace-nowrap rounded-lg px-4 py-1.5 text-[13px] transition-colors duration-[160ms] before:col-start-1 before:row-start-1 before:invisible before:font-bold before:content-[attr(data-label)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--primary)]";

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("inline-flex gap-0.5 rounded-lg border p-[3px]", className)}
      style={TRACK_BORDER}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            data-label={opt.label}
            onClick={() => onChange(opt.value)}
            className={cn(
              SEGMENT,
              active
                ? "bg-foreground font-bold text-background"
                : "font-medium text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground",
            )}
          >
            <span className="col-start-1 row-start-1">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
