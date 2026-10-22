import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProgressStepsProps {
  steps: string[];
  current: number;
}

/* Equal columns with each circle centred in its own, so every connector is
   the same length whatever the labels say. Flex items sized by their labels
   made "Brief" to "Imagery" twice the length of "Imagery" to "Layout". The
   connector runs from the previous column's centre to this one's, stopping
   4px short of each 24px circle. */
const CONNECTOR =
  "absolute top-[11px] right-[calc(50%+16px)] left-[calc(-50%+16px)] h-0.5 rounded-full";

/* The active step's text is --status-progress-fg, not --primary: primary as
   12px text is 3.78:1 on white and 4.40:1 on the dark dialog. The ring is a
   non-text indicator, so --primary clears 3:1 there. */
export function ProgressSteps({ steps, current }: ProgressStepsProps) {
  return (
    <ol className="grid auto-cols-[minmax(0,1fr)] grid-flow-col">
      {steps.map((label, index) => {
        const isCompleted = index < current;
        const isActive = index === current;

        return (
          <li
            key={label}
            className="relative flex flex-col items-center gap-1.5"
            aria-current={isActive ? "step" : undefined}
          >
            {index > 0 && (
              <span
                aria-hidden="true"
                data-slot="progress-connector"
                data-reached={index <= current || undefined}
                className={cn(
                  CONNECTOR,
                  index <= current ? "bg-primary" : "bg-[var(--border)]",
                )}
              />
            )}
            <div
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold",
                isCompleted && "bg-primary text-white",
                isActive &&
                  "ring-2 ring-primary text-[var(--status-progress-fg)] bg-transparent",
                !isCompleted &&
                  !isActive &&
                  "text-[var(--text-muted)] border border-[var(--border)]",
              )}
            >
              {isCompleted ? <Check size={14} /> : <span>{index + 1}</span>}
            </div>
            <span
              className={cn(
                "px-1 text-center text-[12px] leading-tight",
                isActive && "text-[var(--status-progress-fg)] font-medium",
                isCompleted && "text-foreground",
                !isCompleted && !isActive && "text-[var(--text-muted)]",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
