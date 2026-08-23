"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

export interface TourCardProps {
  title: string;
  body: string;
  /** 1-based position, or null on the opening prompt card. */
  step: number | null;
  total: number;
  primaryLabel: string;
  secondaryLabel?: string;
  titleId: string;
  bodyId: string;
  onPrimary: () => void;
  onSecondary?: () => void;
  onClose: () => void;
}

/**
 * The tour's visual body, used identically inside an anchored popover and the
 * centered fallback. Holds no tour state — it is given a step and reports
 * clicks, which keeps every branch of it reachable from a plain unit test.
 */
export function TourCard({
  title,
  body,
  step,
  total,
  primaryLabel,
  secondaryLabel,
  titleId,
  bodyId,
  onPrimary,
  onSecondary,
  onClose,
}: TourCardProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Focus follows the step so Enter advances and a keyboard user is never
  // stranded on a control that just re-rendered underneath them.
  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  return (
    <div className="w-[min(20rem,calc(100vw-2rem))] space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2
          id={titleId}
          className="font-display text-[15px] font-bold text-foreground"
        >
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close tour"
          className="-m-1 shrink-0 rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      <p
        id={bodyId}
        className="text-[13px] leading-relaxed text-[var(--text-secondary)]"
      >
        {body}
      </p>

      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-[12px] text-[var(--text-muted)]">
          {step === null ? "" : `${step} of ${total}`}
        </span>
        <div className="flex items-center gap-2">
          {secondaryLabel && onSecondary && (
            <Button variant="ghost" size="lg" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
          <Button
            ref={primaryRef}
            variant="default"
            size="lg"
            onClick={onPrimary}
          >
            {primaryLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
