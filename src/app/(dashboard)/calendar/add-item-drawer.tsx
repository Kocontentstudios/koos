"use client";

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
import { formatLongDate } from "@/lib/calendar/labels";
import type { CalendarItemFormInput } from "./actions";
import { createCalendarItemAction } from "./actions";
import { emptyDraft, ItemFormFields } from "./item-form";

interface AddItemDrawerProps {
  calendarId: string;
  /** The clicked day; null while the drawer is closed. */
  date: Date | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Add an entry the user planned themselves, seeded with the clicked date. */
export function AddItemDrawer({
  calendarId,
  date,
  open,
  onOpenChange,
}: AddItemDrawerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<CalendarItemFormInput | null>(null);

  // Reseed whenever a different day is opened, without an effect (the React
  // "adjusting state on prop change" pattern used by the detail drawer).
  const seedKey = date ? date.toISOString() : null;
  const [prevSeed, setPrevSeed] = useState(seedKey);
  if (seedKey !== prevSeed) {
    setPrevSeed(seedKey);
    setDraft(date ? emptyDraft(date) : null);
  }
  if (date && !draft) setDraft(emptyDraft(date));

  function patchDraft(patch: Partial<CalendarItemFormInput>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  /* Escape and backdrop clicks arrive here too, not just the Cancel button.
     Resetting on the button alone meant two dismissal gestures on the same
     drawer left different state behind, with nothing telling the user which
     one they got. */
  function handleOpenChange(next: boolean) {
    if (!next) setDraft(date ? emptyDraft(date) : null);
    onOpenChange(next);
  }

  function handleCreate() {
    if (!draft) return;
    startTransition(async () => {
      try {
        const res = await createCalendarItemAction(calendarId, draft);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Added to calendar");
        // Reseeding keys on the date, so reopening the SAME day would other-
        // wise show the entry just created and invite a duplicate.
        handleOpenChange(false);
        router.refresh();
      } catch (err) {
        console.error("createCalendarItemAction threw", err);
        toast.error("Could not add the entry");
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-md"
      >
        {draft && (
          <>
            <SheetHeader className="gap-2 pr-10">
              <SheetTitle className="text-lg">Add to calendar</SheetTitle>
              <SheetDescription>
                {date ? formatLongDate(date) : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="px-4 pb-4">
              <ItemFormFields
                draft={draft}
                onPatch={patchDraft}
                idPrefix="add-ci"
                showBrief={false}
              />
            </div>

            <SheetFooter className="flex-row justify-end gap-2 border-t border-[var(--border)]">
              <Button
                variant="ghost"
                size="lg"
                onClick={() => handleOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="lg"
                onClick={handleCreate}
                loading={isPending}
                loadingText="Adding…"
                disabled={draft.title.trim() === ""}
              >
                Add to calendar
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
