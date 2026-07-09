"use client";

import { Clock, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
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
import {
  type UpdateCalendarItemInput,
  updateCalendarItemAction,
  updateCalendarItemStatusAction,
} from "./actions";
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

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-surface-1 px-3 py-2 text-[13px] text-foreground transition-colors hover:border-[var(--border-accent)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)]";

function EditField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/** YYYY-MM-DD for the date input, from the item's UTC date. */
function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function draftFromItem(item: CalendarItem): UpdateCalendarItemInput {
  return {
    title: item.title,
    brief: item.brief,
    date: dateInputValue(item.date),
    time: item.time,
    platform: item.platform,
    contentType: item.contentType,
    designRequired: item.designRequired,
    designType: item.designType,
    dimensions: item.dimensions,
  };
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<UpdateCalendarItemInput | null>(null);
  // Re-sync local state whenever a different item is opened, without an
  // effect (the React "adjusting state on prop change" pattern).
  const [prevItemId, setPrevItemId] = useState(item?.id);
  if (item && item.id !== prevItemId) {
    setPrevItemId(item.id);
    setStatus(item.status);
    setEditing(false);
    setDraft(null);
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

  function startEditing() {
    if (!item) return;
    setDraft(draftFromItem(item));
    setEditing(true);
  }

  function patchDraft(patch: Partial<UpdateCalendarItemInput>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function handleSave() {
    if (!item || !draft) return;
    startTransition(async () => {
      const res = await updateCalendarItemAction(item.id, draft);
      if (res.ok) {
        toast.success("Calendar item updated");
        setEditing(false);
        setDraft(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-md"
      >
        {item && !editing && (
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
              <Button
                variant="ghost"
                size="sm"
                className="w-fit gap-1.5 px-2.5"
                onClick={startEditing}
              >
                <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                Edit details
              </Button>
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
                    <span className="inline-flex items-center rounded-full bg-[rgba(19,139,200,0.15)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--status-progress-fg)]">
                      Design Required
                    </span>
                    <p className="text-[var(--text-secondary)]">
                      {item.designType ?? "Design asset"}
                      {item.dimensions ? ` · ${item.dimensions}` : ""}
                    </p>
                    {submitted && (
                      <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--status-ready-fg)]">
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

        {item && editing && draft && (
          <>
            <SheetHeader className="gap-2 pr-10">
              <SheetTitle className="text-lg">Edit Calendar Item</SheetTitle>
              <SheetDescription>
                Changes apply to this scheduled item only.
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 px-4 pb-4">
              <EditField id="ci-title" label="Title">
                <input
                  id="ci-title"
                  type="text"
                  value={draft.title}
                  onChange={(e) => patchDraft({ title: e.target.value })}
                  className={inputCls}
                  maxLength={300}
                />
              </EditField>

              <EditField id="ci-brief" label="Caption / Brief">
                <textarea
                  id="ci-brief"
                  value={draft.brief ?? ""}
                  onChange={(e) => patchDraft({ brief: e.target.value })}
                  rows={5}
                  className={inputCls}
                  maxLength={5000}
                />
              </EditField>

              <div className="grid grid-cols-2 gap-3">
                <EditField id="ci-date" label="Date">
                  <input
                    id="ci-date"
                    type="date"
                    value={draft.date}
                    onChange={(e) => patchDraft({ date: e.target.value })}
                    className={inputCls}
                  />
                </EditField>
                <EditField id="ci-time" label="Time">
                  <input
                    id="ci-time"
                    type="text"
                    value={draft.time ?? ""}
                    onChange={(e) => patchDraft({ time: e.target.value })}
                    placeholder="e.g. 10:00 AM"
                    className={inputCls}
                    maxLength={50}
                  />
                </EditField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <EditField id="ci-platform" label="Platform">
                  <input
                    id="ci-platform"
                    type="text"
                    value={draft.platform}
                    onChange={(e) => patchDraft({ platform: e.target.value })}
                    className={inputCls}
                    maxLength={100}
                  />
                </EditField>
                <EditField id="ci-content-type" label="Content Type">
                  <input
                    id="ci-content-type"
                    type="text"
                    value={draft.contentType}
                    onChange={(e) =>
                      patchDraft({ contentType: e.target.value })
                    }
                    className={inputCls}
                    maxLength={100}
                  />
                </EditField>
              </div>

              <Divider />

              <label className="flex items-center gap-2.5 text-[13px] text-foreground">
                <input
                  type="checkbox"
                  checked={draft.designRequired}
                  onChange={(e) =>
                    patchDraft({ designRequired: e.target.checked })
                  }
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                Design asset required
              </label>

              {draft.designRequired && (
                <div className="grid grid-cols-2 gap-3">
                  <EditField id="ci-design-type" label="Design Type">
                    <input
                      id="ci-design-type"
                      type="text"
                      value={draft.designType ?? ""}
                      onChange={(e) =>
                        patchDraft({ designType: e.target.value })
                      }
                      placeholder="e.g. Carousel"
                      className={inputCls}
                      maxLength={100}
                    />
                  </EditField>
                  <EditField id="ci-dimensions" label="Dimensions">
                    <input
                      id="ci-dimensions"
                      type="text"
                      value={draft.dimensions ?? ""}
                      onChange={(e) =>
                        patchDraft({ dimensions: e.target.value })
                      }
                      placeholder="e.g. 1080x1350"
                      className={inputCls}
                      maxLength={100}
                    />
                  </EditField>
                </div>
              )}
            </div>

            <SheetFooter className="flex-row justify-end gap-2 border-t border-[var(--border)]">
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  setEditing(false);
                  setDraft(null);
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="lg"
                onClick={handleSave}
                loading={isPending}
                loadingText="Saving…"
                disabled={draft.title.trim() === ""}
              >
                Save Changes
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
