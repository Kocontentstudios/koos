"use client";

import { createContext, useContext } from "react";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Dialog titles only work inside a Dialog root. The same views also render
 * statically (the preview harness and tests of a single state), so the heading
 * element is chosen by where the view is mounted rather than duplicated.
 */
const FlowChrome = createContext<"dialog" | "static">("dialog");

export const FlowChromeProvider = FlowChrome.Provider;

const TITLE =
  "font-display text-[18px] leading-tight font-bold text-foreground";
const DESCRIPTION = "text-[13px] leading-relaxed text-[var(--text-secondary)]";

export function FlowTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return useContext(FlowChrome) === "dialog" ? (
    <DialogTitle className={cn(TITLE, className)}>{children}</DialogTitle>
  ) : (
    <h2 className={cn(TITLE, className)}>{children}</h2>
  );
}

export function FlowDescription({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return useContext(FlowChrome) === "dialog" ? (
    <DialogDescription className={cn(DESCRIPTION, className)}>
      {children}
    </DialogDescription>
  ) : (
    <p className={cn(DESCRIPTION, className)}>{children}</p>
  );
}
