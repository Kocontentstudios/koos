import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProgressStepsProps {
  steps: string[];
  current: number;
}

export function ProgressSteps({ steps, current }: ProgressStepsProps) {
  return (
    <ol className="flex items-center gap-0">
      {steps.map((label, index) => {
        const isCompleted = index < current;
        const isActive = index === current;

        return (
          <li
            key={label}
            className="flex flex-1 items-center"
            aria-current={isActive ? "step" : undefined}
          >
            {/* Connector line before (skip for first) */}
            {index > 0 && (
              <div
                className={cn(
                  "h-px flex-1",
                  isCompleted
                    ? "bg-primary"
                    : index <= current
                      ? "bg-primary"
                      : "bg-[var(--border)]",
                )}
              />
            )}
            <div className="flex flex-col items-center gap-1.5">
              {/* Circle */}
              <div
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold",
                  isCompleted && "bg-primary text-white",
                  isActive && "ring-2 ring-primary text-primary bg-transparent",
                  !isCompleted &&
                    !isActive &&
                    "text-[var(--text-muted)] border border-[var(--border)]",
                )}
              >
                {isCompleted ? <Check size={14} /> : <span>{index + 1}</span>}
              </div>
              {/* Label */}
              <span
                className={cn(
                  "text-[12px] whitespace-nowrap",
                  isActive && "text-primary font-medium",
                  isCompleted && "text-foreground",
                  !isCompleted && !isActive && "text-[var(--text-muted)]",
                )}
              >
                {label}
              </span>
            </div>
            {/* Connector line after (for completed steps) */}
            {index < steps.length - 1 && index >= current && (
              <div className={cn("h-px flex-1", "bg-[var(--border)]")} />
            )}
            {index < steps.length - 1 && index < current && (
              <div className="h-px flex-1 bg-primary" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
