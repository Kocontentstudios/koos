"use client";

import { Clock, Pencil, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { GenerateDesignButton } from "@/components/design/generate-design-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/ui/markdown";
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
  type CalendarItemFormInput,
  deleteCalendarItemAction,
  updateCalendarItemAction,
  updateCalendarItemStatusAction,
} from "./actions";
import { draftFromItem, ItemFormFields } from "./item-form";
import type { CalendarItem, CalendarItemStatus } from "./types";
import { sourceLabel, statusLabel } from "./types";

interface CalendarItemDrawerProps {
  item: CalendarItem | null;
  brandId: string;
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

/** Where the entry came from, so an edited AI post is still recognizable. */
function SourcePill({ item }: { item: CalendarItem }) {
  const manual = item.source === "manual";
  const Icon = manual ? Pencil : Sparkles;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(19,139,200,0.15)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--status-progress-fg)]">
      <Icon aria-hidden="true" className="h-2.5 w-2.5" />
      {sourceLabel(item.source)}
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
  brandId,
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
  const [draft, setDraft] = useState<CalendarItemFormInput | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Re-sync local state whenever a different item is opened, without an
  // effect (the React "adjusting state on prop change" pattern).
  const [prevItemId, setPrevItemId] = useState(item?.id);
  if (item && item.id !== prevItemId) {
    setPrevItemId(item.id);
    setStatus(item.status);
    setEditing(false);
    setDraft(null);
    setConfirmingDelete(false);
  }

  function handleStatusChange(next: CalendarItemStatus) {
    if (!item) return;
    const prev = status;
    setStatus(next); // optimistic
    startTransition(async () => {
      /* A rejection (offline, 500, a stale action id mid-deploy) must revert
         too. Reverting only on res.ok === false would leave the select showing
         a status the database never took, with nothing telling the user. */
      try {
        const res = await updateCalendarItemStatusAction(item.id, next);
        if (res.ok) {
          router.refresh();
          return;
        }
        setStatus(prev);
        toast.error(res.error);
      } catch (err) {
        console.error("updateCalendarItemStatusAction threw", err);
        setStatus(prev);
        toast.error("Could not update status");
      }
    });
  }

  /*
   * Every dismissal — the X, Escape, a backdrop click — must abandon the edit,
   * not just the Cancel button. Retaining `draft` across a close meant
   * reopening the item showed stale text over a `router.refresh()`-updated
   * item, and the next Save wrote that abandoned text over whatever a
   * teammate had saved in between.
   */
  function handleOpenChange(next: boolean) {
    if (!next) {
      setEditing(false);
      setDraft(null);
      setConfirmingDelete(false);
      /* The prop-resync below keys on a CHANGED item id, so reopening the
         same item would otherwise keep a stale optimistic status and show a
         value the database never took. */
      setStatus(item?.status ?? "draft");
    }
    onOpenChange(next);
  }

  function startEditing() {
    if (!item) return;
    setDraft(draftFromItem(item));
    setEditing(true);
  }

  function patchDraft(patch: Partial<CalendarItemFormInput>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function handleSave() {
    if (!item || !draft) return;
    startTransition(async () => {
      try {
        const res = await updateCalendarItemAction(item.id, draft);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Calendar item updated");
        setEditing(false);
        setDraft(null);
        router.refresh();
      } catch (err) {
        console.error("updateCalendarItemAction threw", err);
        toast.error("Could not save changes");
      }
    });
  }

  function handleDelete() {
    if (!item) return;
    startTransition(async () => {
      try {
        const res = await deleteCalendarItemAction(item.id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Entry deleted");
        handleOpenChange(false);
        router.refresh();
      } catch (err) {
        console.error("deleteCalendarItemAction threw", err);
        toast.error("Could not delete the entry");
      }
    });
  }

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
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
                  <SourcePill item={item} />
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
                {item.caption && (
                  <>
                    <Divider />
                    {/* Literal post copy, so it renders verbatim rather than
                        through Markdown, which would eat #hashtags. */}
                    <Section label="Caption">
                      <p className="whitespace-pre-wrap text-[13px]">
                        {item.caption}
                      </p>
                    </Section>
                  </>
                )}

                {/* A manual entry never had a brief to begin with; only KO's
                    own items get the "still writing" placeholder. */}
                {(item.brief || item.source === "ai") && (
                  <>
                    <Divider />
                    <Section label="Brief">
                      {item.brief ? (
                        <Markdown className="text-[13px]">
                          {item.brief}
                        </Markdown>
                      ) : (
                        <p className="text-[13px] italic text-[var(--text-muted)]">
                          KO is still writing this brief. It will appear here
                          shortly — the rest of the item is ready to use now.
                        </p>
                      )}
                    </Section>
                  </>
                )}

                {item.notes && (
                  <>
                    <Divider />
                    <Section label="Notes">
                      <p className="whitespace-pre-wrap text-[13px] text-[var(--text-muted)]">
                        {item.notes}
                      </p>
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
                    aria-label="Status"
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

              <SheetFooter className="flex-row items-center gap-2 border-t border-[var(--border)]">
                <Button
                  variant="ghost"
                  size="lg"
                  className="mr-auto gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                  Delete
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => handleOpenChange(false)}
                >
                  Close
                </Button>
                {submitted ? (
                  <Button variant="secondary" size="lg" disabled>
                    Design Ticket Submitted
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={onRequestDesign}
                    >
                      Send to design team
                    </Button>
                    {/* designRequired was a planning hint from calendar
                        generation, never an entitlement — gating the button on
                        it hid the feature on most items. */}
                    <GenerateDesignButton
                      brandId={brandId}
                      calendarItemId={item.id}
                      label="Generate with AI"
                      ticketContext={{
                        calendarItemId: item.id,
                        designType: item.designType ?? item.contentType,
                        dimensions: item.dimensions,
                        brief: item.brief ?? item.caption ?? item.title,
                      }}
                    />
                  </>
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

              <div className="px-4 pb-4">
                <ItemFormFields
                  draft={draft}
                  onPatch={patchDraft}
                  idPrefix="ci"
                />
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

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this entry?</DialogTitle>
            <DialogDescription>
              “{item?.title}” will be removed from the calendar. Design tickets
              you already sent are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingDelete(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              loading={isPending}
              loadingText="Deleting…"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
