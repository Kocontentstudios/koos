"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { FrameFace, type Size } from "./frame-face";
import {
  type DesignSet,
  type FrameSlot,
  frameState,
  kindNoun,
  roleLabel,
} from "./set-model";
import { indexForKey } from "./set-stage";

export function tabIdOf(baseId: string, index: number): string {
  return `${baseId}-frame-${index}`;
}

export interface FrameRailProps {
  set: DesignSet;
  size: Size;
  selected: number;
  onSelect: (index: number) => void;
  isRegenerating: (slot: FrameSlot) => boolean;
  /** The accessible name of each tab. */
  frameLabel: (slot: FrameSlot) => string;
  baseId: string;
  panelId: string;
}

/**
 * Every frame of the set in order, small, under the stage: the filmstrip
 * that says this is one carousel, and the control that picks the frame on
 * show. A tablist, so arrow keys walk it and Tab leaves it in one press.
 */
export function FrameRail({
  set,
  size,
  selected,
  onSelect,
  isRegenerating,
  frameLabel,
  baseId,
  panelId,
}: FrameRailProps) {
  const rail = useRef<HTMLDivElement>(null);
  const count = set.frames.length;

  useEffect(() => {
    rail.current
      ?.querySelector<HTMLElement>(`[data-rail-index="${selected}"]`)
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selected]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const next = indexForKey(e.key, selected, count);
    if (next === null) return;
    e.preventDefault();
    onSelect(next);
    document.getElementById(tabIdOf(baseId, next))?.focus();
  }

  const wide = size.width > size.height;

  return (
    <div
      ref={rail}
      role="tablist"
      aria-label={`Frames of this ${kindNoun(set.kind)}`}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pt-1 pb-2"
    >
      {set.frames.map((slot) => {
        const active = slot.index === selected;
        const state = frameState(slot);
        const broken = state === "failed" || state === "missing";
        return (
          <button
            key={slot.index}
            id={tabIdOf(baseId, slot.index)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId}
            aria-label={frameLabel(slot)}
            tabIndex={active ? 0 : -1}
            data-rail-index={slot.index}
            data-state={state}
            onClick={() => onSelect(slot.index)}
            className={cn(
              "group flex shrink-0 snap-start flex-col gap-1.5 rounded-lg p-1 text-left outline-none focus-visible:focus-outline",
              wide ? "w-[112px]" : "w-[76px]",
            )}
          >
            <span
              className="relative block w-full overflow-hidden rounded-md border-2 bg-[var(--surface-container-lowest)] transition-colors"
              style={{
                aspectRatio: `${size.width} / ${size.height}`,
                borderColor: active
                  ? "var(--border-accent)"
                  : broken
                    ? "var(--status-error-fg)"
                    : "transparent",
              }}
            >
              <FrameFace
                slot={slot}
                alt=""
                size={size}
                mode={isRegenerating(slot) ? "regenerating" : "frame"}
                compact
              />
              <span
                aria-hidden="true"
                className="absolute top-1 left-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-[11px] font-semibold tabular-nums text-white"
              >
                {slot.index + 1}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold",
                active
                  ? "bg-[var(--status-progress-bg)] text-[var(--status-progress-fg)]"
                  : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]",
              )}
            >
              {roleLabel(set.kind, slot.role)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
