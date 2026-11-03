"use client";

import { useRef } from "react";
import { TOUCH_HEIGHT } from "@/components/design/sequence/outline-step";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Asked before an edited outline is closed. Rendered inside the directions
 * dialog so Base UI treats it as nested: the outline goes inert under it and
 * Escape or a tap beside it only closes this, which keeps the edits.
 */
export function DiscardOutlineConfirm({
  open,
  onKeep,
  onDiscard,
}: {
  open: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  /* Keep is the safe answer, so a reflexive Enter or a second Escape never
     throws the work away. */
  const keepRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onKeep()}>
      <DialogContent
        role="alertdialog"
        showCloseButton={false}
        initialFocus={keepRef}
      >
        <DialogHeader>
          <DialogTitle>Discard your outline edits?</DialogTitle>
          <DialogDescription>
            Closing now loses the changes you made to the slides. KO plans a new
            outline the next time you start.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={keepRef}
            type="button"
            variant="outline"
            className={TOUCH_HEIGHT}
            onClick={onKeep}
          >
            Keep editing
          </Button>
          <Button
            type="button"
            variant="destructive"
            className={TOUCH_HEIGHT}
            onClick={onDiscard}
          >
            Discard edits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
