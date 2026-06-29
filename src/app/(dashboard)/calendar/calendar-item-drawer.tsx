"use client";

import { Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDateTime } from "@/lib/calendar/labels";
import { updateCalendarItemStatusAction } from "./actions";
import type { CalendarItem, CalendarItemStatus } from "./types";
import { statusLabel } from "./types";

interface CalendarItemDrawerProps {
  item: CalendarItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether this item already has a design ticket. */
  submitted: boolean;
  /** Open the prefilled Request Design modal for this item. */
  onRequestDesign: () => void;
}

const STATUS_OPTIONS: CalendarItemStatus[] = [
  "draft",
  "in_progress",
  "ready",
  "published",
];

function Divider() {
  return <div className="h-px bg-[var(--divider)]" />;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[rgba(255,255,255,0.06)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
      {children}
    </span>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
        {children}
      </div>
    </div>
  );
}

export function CalendarItemDrawer({
  item,
  open,
  onOpenChange,
  submitted,
  onRequestDesign,
}: CalendarItemDrawerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<CalendarItemStatus>(
    item?.status ?? "draft",
  );
  // Re-sync the local select whenever a different item is opened, without an
  // effect (the React "adjusting state on prop change" pattern).
  const [prevItemId, setPrevItemId] = useState(item?.id);
  if (item && item.id !== prevItemId) {
    setPrevItemId(item.id);
    setStatus(item.status);
  }

  function handleStatusChange(next: CalendarItemStatus) {
    if (!item) return;
    const prev = status;
    setStatus(next); // optimistic
    startTransition(async () => {
      const res = await updateCalendarItemStatusAction(item.id, next);
      if (res.ok) {
        router.refresh();
      } else {
        setStatus(prev); // revert on failure
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-md"
      >
        {item && (
          <>
            <SheetHeader className="gap-2 pr-10">
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill>{item.platform}</Pill>
                <Pill>{item.contentType}</Pill>
              </div>
              <SheetTitle className="text-lg">{item.title}</SheetTitle>
              <SheetDescription>
                {formatDateTime(item.date, item.time)}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-5 px-4 pb-4">
              {item.brief && (
                <>
                  <Divider />
                  <Section label="Caption / Brief">
                    <p className="whitespace-pre-wrap">{item.brief}</p>
                  </Section>
                </>
              )}

              <Divider />
              <Section label="Design Asset">
                {item.designRequired ? (
                  <div className="space-y-1.5">
                    <span className="inline-flex items-center rounded-full bg-[rgba(19,139,200,0.15)] px-2.5 py-0.5 text-[10px] font-medium text-[#85B7EB]">
                      Design Required
                    </span>
                    <p className="text-[var(--text-secondary)]">
                      {item.designType ?? "Design asset"}
                      {item.dimensions ? ` · ${item.dimensions}` : ""}
                    </p>
                    {submitted && (
                      <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#97C459]">
                        <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                        Design Ticket Submitted
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-[var(--text-muted)]">
                    No design asset needed
                  </span>
                )}
              </Section>

              <Divider />
              <Section label="Status">
                <select
                  value={status}
                  onChange={(e) =>
                    handleStatusChange(e.target.value as CalendarItemStatus)
                  }
                  disabled={isPending}
                  className="w-[200px] cursor-pointer rounded-lg border border-[var(--border)] bg-surface-1 px-3.5 py-2 text-[13px] text-foreground transition-colors hover:border-[var(--border-accent)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)] disabled:opacity-60"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              </Section>
            </div>

            <SheetFooter className="flex-row justify-end gap-2 border-t border-[var(--border)]">
              <Button
                variant="ghost"
                size="lg"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              {submitted ? (
                <Button variant="secondary" size="lg" disabled>
                  Design Ticket Submitted
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="lg"
                  onClick={onRequestDesign}
                  disabled={!item.designRequired}
                >
                  Request Design
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
