import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProgressStepsProps {
  steps: string[];
  current: number;
  /** When provided, steps become clickable and jump directly to that index. */
  onSelect?: (index: number) => void;
}

/**
 * Horizontal progress indicator aligned to the create-brand template:
 * 28px circles (2px border), fixed ~40px connectors, solid-fill when
 * completed and outlined when active. Labels collapse on small screens so
 * the 7-step bar never clips.
 */
export function ProgressSteps({
  steps,
  current,
  onSelect,
}: ProgressStepsProps) {
  return (
    <ol className="flex flex-wrap items-center justify-center gap-y-2.5 sm:justify-start">
      {steps.map((label, index) => {
        const isCompleted = index < current;
        const isActive = index === current;

        const content = (
          <>
            <div
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-[12px] font-semibold transition-colors",
                isCompleted &&
                  "border-primary bg-primary text-primary-foreground",
                isActive && "border-primary bg-surface-1 text-primary",
                !isCompleted &&
                  !isActive &&
                  "border-[var(--text-muted)] text-[var(--text-muted)]",
              )}
            >
              {isCompleted ? <Check className="size-3.5" /> : index + 1}
            </div>
            <span
              className={cn(
                "hidden text-[12px] font-medium whitespace-nowrap transition-colors sm:inline",
                isActive && "text-primary",
                isCompleted && "text-[var(--text-secondary)]",
                !isCompleted && !isActive && "text-[var(--text-muted)]",
              )}
            >
              {label}
            </span>
          </>
        );

        return (
          <li
            key={label}
            className="flex items-center"
            aria-current={isActive ? "step" : undefined}
          >
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-label={`Go to step ${index + 1}: ${label}`}
                className={cn(
                  "flex items-center gap-2 rounded-lg p-0.5 transition-opacity",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  !isActive && "cursor-pointer hover:opacity-80",
                )}
              >
                {content}
              </button>
            ) : (
              <div className="flex items-center gap-2">{content}</div>
            )}
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "mx-2 h-0.5 w-3 shrink-0 transition-colors sm:w-6 md:w-10",
                  isCompleted ? "bg-primary" : "bg-[var(--border)]",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
