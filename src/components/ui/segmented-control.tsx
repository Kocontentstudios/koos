"use client";

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  label: string;
  value: T;
}

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
      className={cn(
        "inline-flex gap-0.5 rounded-lg bg-[rgba(255,255,255,0.04)] p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors duration-150",
              active
                ? "bg-surface-2 text-foreground"
                : "text-[var(--text-secondary)] hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
