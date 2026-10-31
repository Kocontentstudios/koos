"use client";

import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SheetFooter } from "@/components/ui/sheet";

export const CALENDAR_DRAWER_CLASS =
  "w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-md";

export interface CalendarItemActionsProps {
  /** Whether this item already has a design ticket. */
  submitted: boolean;
  onDelete: () => void;
  onClose: () => void;
  onRequestDesign: () => void;
  /** The generate launcher, rendered full width on its own row. */
  generate: ReactNode;
}

/**
 * Four actions never fit one row of a 448px sheet, let alone a 292px phone
 * sheet, and a nowrap row pushed "Generate with AI" off-screen. So, as in
 * prototype 03, Generate gets its own full-width row and the other three
 * share the row above. Sized by the sheet, not the viewport: below 24rem of
 * footer, "Send to design team" takes its own row too.
 */
export function CalendarItemActions({
  submitted,
  onDelete,
  onClose,
  onRequestDesign,
  generate,
}: CalendarItemActionsProps) {
  return (
    <SheetFooter
      data-testid="calendar-item-actions"
      className="@container border-t border-[var(--border)]"
    >
      <div className="grid grid-cols-2 gap-2 @sm:grid-cols-[auto_auto_minmax(0,1fr)]">
        <Button
          variant="ghost"
          size="lg"
          className="gap-1.5 text-[var(--status-error-fg)] hover:text-[var(--status-error-fg)]"
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          Delete
        </Button>
        <Button variant="ghost" size="lg" onClick={onClose}>
          Close
        </Button>
        {submitted ? (
          <Button
            variant="secondary"
            size="lg"
            disabled
            className="col-span-2 @sm:col-span-1"
          >
            Design Ticket Submitted
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="lg"
            onClick={onRequestDesign}
            className="col-span-2 @sm:col-span-1"
          >
            Send to design team
          </Button>
        )}
      </div>
      {submitted ? null : generate}
    </SheetFooter>
  );
}
