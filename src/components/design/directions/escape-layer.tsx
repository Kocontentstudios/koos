"use client";

import { createContext, useContext, useEffect, useRef } from "react";

type Dismiss = () => void;

/**
 * Escape closes the innermost thing first. Base UI's Dialog only knows about
 * itself, so a confirm opened inside it registers here and the dialog's
 * onOpenChange asks this stack before it closes.
 */
const EscapeLayers = createContext<Dismiss[] | null>(null);

export const EscapeLayerProvider = EscapeLayers.Provider;

export function useEscapeLayerStack() {
  const stack = useRef<Dismiss[]>([]);
  return {
    stack: stack.current,
    /** Closes the innermost open layer; false when none is open. */
    dismissInnermost(): boolean {
      const innermost = stack.current.at(-1);
      innermost?.();
      return innermost !== undefined;
    },
  };
}

export function useEscapeLayer(open: boolean, onEscape: Dismiss) {
  const stack = useContext(EscapeLayers);
  const latest = useRef(onEscape);
  useEffect(() => {
    latest.current = onEscape;
  });
  useEffect(() => {
    if (!open || !stack) return;
    const layer: Dismiss = () => latest.current();
    stack.push(layer);
    return () => {
      const at = stack.lastIndexOf(layer);
      if (at !== -1) stack.splice(at, 1);
    };
  }, [open, stack]);
}
