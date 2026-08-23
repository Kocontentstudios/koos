"use client";

import { useEffect, useState } from "react";
import { type TourAnchorId, tourAnchorSelector } from "@/lib/tour/anchors";

/** Mobile drawer transition is duration-200 (app-sidebar.tsx); allow a margin. */
const SETTLE_MS = 250;

export function prefersReducedMotion(): boolean {
  // jsdom implements neither matchMedia nor layout.
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isMobileViewport(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(max-width: 767px)").matches;
}

/**
 * Resolves a step's anchor element, retrying across two frames and then a
 * settle timeout so a sidebar row that is still sliding in is not mistaken for
 * a missing anchor.
 *
 * Returns `null` once genuinely absent, which callers render as an unanchored
 * centered card — the copy still reaches the user. `resolved` distinguishes
 * "still looking" from "looked and found nothing", so the caller does not fire
 * a missing-anchor event on the first frame of every step.
 */
export function useTourAnchor(anchor: TourAnchorId | null): {
  element: HTMLElement | null;
  resolved: boolean;
} {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (!anchor) {
      setElement(null);
      setResolved(true);
      return;
    }

    setElement(null);
    setResolved(false);

    let cancelled = false;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout>;

    const find = () =>
      document.querySelector<HTMLElement>(tourAnchorSelector(anchor));

    const settle = (found: HTMLElement | null) => {
      if (cancelled) return;
      setElement(found);
      setResolved(true);
    };

    const immediate = find();
    if (immediate) {
      settle(immediate);
    } else {
      frame = requestAnimationFrame(() => {
        const second = find();
        if (second) return settle(second);
        timer = setTimeout(() => settle(find()), SETTLE_MS);
      });
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [anchor]);

  return { element, resolved };
}

/**
 * Brings a dashboard anchor into view. Sidebar anchors are inside a `fixed`
 * aside, so scrolling for them would be a jump to nowhere.
 *
 * `<main>` is the scroll container, not the window (dashboard-shell.tsx) —
 * scrollIntoView walks nested scroll containers natively, so no manual maths.
 */
export function scrollAnchorIntoView(
  element: HTMLElement | null,
  isNav: boolean,
): void {
  if (!element || isNav) return;
  element.scrollIntoView({
    block: "center",
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
}
