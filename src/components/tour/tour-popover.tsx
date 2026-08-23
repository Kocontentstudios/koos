"use client";

import { Popover } from "@base-ui/react/popover";

export type TourCloseReason = "escape" | "outside" | "other";

/**
 * Anchored shell for one tour step. The only module that imports base-ui's
 * popover, so the rest of the tour stays renderable in jsdom.
 *
 * `modal={false}` is deliberate: a tour points at live UI while the user looks
 * at it, so trapping focus and locking scroll would fight the thing being
 * demonstrated. Accessibility comes from the dialog role, the labelled title,
 * and the live-region announcement in ProductTour instead.
 */
export function TourPopover({
  anchor,
  side,
  titleId,
  bodyId,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  side: "top" | "bottom" | "left" | "right";
  titleId: string;
  bodyId: string;
  onClose: (reason: TourCloseReason) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover.Root
      open
      modal={false}
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === "escape-key") return onClose("escape");
        if (details.reason === "outside-press") return onClose("outside");
        onClose("other");
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side={side}
          sideOffset={10}
          align="center"
          /* Above the mobile drawer (z-50) and its backdrop (z-40). */
          className="isolate z-[60]"
        >
          <Popover.Popup
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            className="origin-(--transform-origin) rounded-2xl border border-[var(--border-accent)] bg-surface-1 p-4 shadow-[var(--shadow-modal)] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            {children}
            <Popover.Arrow className="size-2.5 rotate-45 rounded-[2px] border border-[var(--border-accent)] bg-surface-1 data-[side=bottom]:top-1 data-[side=left]:-right-1 data-[side=left]:top-1/2! data-[side=left]:-translate-y-1/2 data-[side=right]:-left-1 data-[side=right]:top-1/2! data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
