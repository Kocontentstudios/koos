"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FrameFace, type Size } from "./frame-face";
import type { DesignSet, FrameSlot } from "./set-model";

/* Past this share of the frame's width a drag turns the page, as Instagram
   and LinkedIn do; shorter is read as a tap or a wobble. */
const SWIPE_SHARE = 0.15;
const SWIPE_MIN_PX = 40;
/* A drag only claims the pointer once it is clearly sideways, so a tap
   still reaches what it landed on and a vertical scroll still scrolls. */
const DRAG_START_PX = 8;

export function moveBy(
  index: number,
  step: number,
  count: number,
): number | null {
  const next = index + step;
  return next < 0 || next >= count ? null : next;
}

/** The index a key moves to, or null for a key the stage does not use. */
export function indexForKey(
  key: string,
  index: number,
  count: number,
): number | null {
  switch (key) {
    case "ArrowLeft":
      return moveBy(index, -1, count);
    case "ArrowRight":
      return moveBy(index, 1, count);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

function useSwipe(
  selected: number,
  count: number,
  onSelect: (index: number) => void,
) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const [drag, setDrag] = useState(0);

  function finish(clientX: number | null, width: number) {
    const from = start.current;
    start.current = null;
    setDrag(0);
    if (!from || clientX === null) return;
    const dx = clientX - from.x;
    if (Math.abs(dx) < Math.max(SWIPE_MIN_PX, width * SWIPE_SHARE)) return;
    const next = moveBy(selected, dx < 0 ? 1 : -1, count);
    if (next !== null) onSelect(next);
  }

  return {
    drag,
    handlers: {
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      },
      onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
        const from = start.current;
        if (!from || from.id !== e.pointerId) return;
        const dx = e.clientX - from.x;
        if (
          drag === 0 &&
          (Math.abs(dx) < DRAG_START_PX ||
            Math.abs(dx) < Math.abs(e.clientY - from.y))
        ) {
          return;
        }
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const pastEdge =
          (selected === 0 && dx > 0) || (selected === count - 1 && dx < 0);
        setDrag(pastEdge ? dx / 3 : dx);
      },
      onPointerUp: (e: React.PointerEvent<HTMLDivElement>) =>
        finish(e.clientX, e.currentTarget.clientWidth),
      onPointerCancel: () => finish(null, 0),
    },
  };
}

export interface SetStageProps {
  set: DesignSet;
  size: Size;
  selected: number;
  onSelect: (index: number) => void;
  isRegenerating: (slot: FrameSlot) => boolean;
  frameLabel: (slot: FrameSlot) => string;
  /** Regenerates a frame that failed, from a button on the frame. */
  onRetry: (slot: FrameSlot) => void;
  panelId: string;
  /** The id of the selected frame's tab, which names the panel. */
  tabId: string;
}

/**
 * The selected frame, large, in the box it will be posted in: a phone for a
 * carousel, a 16:9 screen for a presentation. Every frame sits on one track
 * so a swipe drags the next one in, the way the real feed does.
 */
export function SetStage({
  set,
  size,
  selected,
  onSelect,
  isRegenerating,
  frameLabel,
  onRetry,
  panelId,
  tabId,
}: SetStageProps) {
  const count = set.frames.length;
  const swipe = useSwipe(selected, count, onSelect);
  const phone = set.kind === "carousel";

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const next = indexForKey(e.key, selected, count);
    if (next === null) return;
    e.preventDefault();
    onSelect(next);
  }

  const viewport = (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={tabId}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the APG tabs pattern makes a panel with no focusable content a tab stop, so the arrow keys and swipe have a target
      tabIndex={0}
      onKeyDown={onKeyDown}
      {...swipe.handlers}
      data-dragging={swipe.drag !== 0 || undefined}
      className={cn(
        "relative w-full touch-pan-y overflow-hidden bg-[var(--surface-container-lowest)] outline-none select-none focus-visible:focus-outline",
        phone ? "rounded-[18px]" : "rounded-lg",
      )}
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      <div
        className="flex h-full transition-transform duration-300 ease-out motion-reduce:transition-none data-[dragging]:transition-none"
        data-dragging={swipe.drag !== 0 || undefined}
        style={{
          transform: `translateX(calc(${-selected * 100}% + ${swipe.drag}px))`,
        }}
      >
        {set.frames.map((slot) => {
          const away = slot.index !== selected;
          return (
            <div
              key={slot.index}
              aria-hidden={away || undefined}
              inert={away}
              data-frame-index={slot.index}
              className="relative h-full w-full shrink-0"
            >
              <FrameFace
                slot={slot}
                alt={frameLabel(slot)}
                size={size}
                mode={isRegenerating(slot) ? "regenerating" : "frame"}
                onRetry={() => onRetry(slot)}
              />
            </div>
          );
        })}
      </div>
      {/* Instagram's own counter, so the preview reads as the post. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-3 right-3 rounded-full bg-black/60 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-white"
      >
        {selected + 1}/{count}
      </span>
    </div>
  );

  const previous = moveBy(selected, -1, count);
  const next = moveBy(selected, 1, count);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full items-center justify-center gap-2 sm:gap-3">
        <Button
          type="button"
          variant="icon"
          size="icon-lg"
          className="rounded-full max-sm:hidden"
          onClick={() => previous !== null && onSelect(previous)}
          disabled={previous === null}
          focusableWhenDisabled
          aria-label="Previous frame"
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        {phone ? (
          <div
            className="w-full max-w-[340px] rounded-[28px] border bg-[var(--surface-container-low)] p-2.5 shadow-sm"
            style={{ borderColor: "var(--border-control)" }}
          >
            {viewport}
          </div>
        ) : (
          <div
            className="w-full max-w-[640px] rounded-xl border bg-[var(--surface-container-low)] p-1.5 shadow-sm"
            style={{ borderColor: "var(--border-control)" }}
          >
            {viewport}
          </div>
        )}
        <Button
          type="button"
          variant="icon"
          size="icon-lg"
          className="rounded-full max-sm:hidden"
          onClick={() => next !== null && onSelect(next)}
          disabled={next === null}
          focusableWhenDisabled
          aria-label="Next frame"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      {/* The feed's page dots; the rail below is the control. */}
      <div aria-hidden="true" className="flex items-center gap-1.5">
        {set.frames.map((slot) => (
          <span
            key={slot.index}
            className={cn(
              "size-1.5 rounded-full transition-colors",
              slot.index === selected
                ? "bg-primary"
                : "bg-[var(--border-control)]",
            )}
          />
        ))}
      </div>
    </div>
  );
}
