"use client";

import { useEffect, useRef } from "react";
import {
  DIRECTIONS_POPUP_CLASS,
  DIRECTIONS_SCROLL_CLASS,
} from "@/components/design/directions/design-directions-dialog";
import {
  FlowDescription,
  FlowTitle,
} from "@/components/design/directions/flow-heading";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { setHeading } from "./set-heading";
import type { DesignSet } from "./set-model";
import { SetViewer } from "./set-viewer";
import { useFrameSet } from "./use-frame-set";

/**
 * A set from the history grid, opened on its own. `onClose` says whether a
 * frame was replaced, so the grid knows to refetch its cover.
 */
export function SetViewerDialog({
  set,
  onClose,
}: {
  set: DesignSet | null;
  onClose: (changed: boolean) => void;
}) {
  const frames = useFrameSet();
  const changed = useRef(false);
  const { load, refresh } = frames;
  const openSetId = useRef<string | null>(null);

  /* The grid hands over a fresher read of the same set as its frames land
     (useSetWatch). That is a refresh, not a new set: a frame regenerating
     here must keep its pending state and its job. */
  useEffect(() => {
    if (set && set.setId === openSetId.current) {
      refresh(set);
      return;
    }
    openSetId.current = set?.setId ?? null;
    changed.current = false;
    load(set);
  }, [set, load, refresh]);

  /* The set as given until the effect has loaded it into the hook, and the
     last one kept through the close animation, so the dialog is never
     drawn empty on its way in or out. */
  const lastGiven = useRef(set);
  if (set) lastGiven.current = set;
  const given = lastGiven.current;
  const shown =
    frames.set && frames.set.setId === given?.setId ? frames.set : given;
  const busy = frames.actingOn.size > 0;
  const heading = shown ? setHeading(shown) : null;

  return (
    <Dialog
      open={set !== null}
      onOpenChange={(open) => {
        if (!open) onClose(changed.current || busy);
      }}
      disablePointerDismissal={busy}
    >
      <DialogContent
        className={cn(
          DIRECTIONS_POPUP_CLASS,
          "sm:max-w-[min(48rem,calc(100%-2rem))]",
        )}
      >
        <div className={DIRECTIONS_SCROLL_CLASS}>
          {shown && heading ? (
            <>
              <div className="flex flex-col gap-1.5 pr-8 pb-4 max-sm:pr-14">
                <FlowTitle>{heading.title}</FlowTitle>
                <FlowDescription>{heading.description}</FlowDescription>
              </div>
              <SetViewer
                set={shown}
                actingOn={frames.actingOn}
                frameErrors={frames.frameErrors}
                stillRunning={frames.stillRunning}
                onRegenerateFrame={async (id, edits) => {
                  const row = await frames.regenerateFrame(id, edits);
                  if (row) changed.current = true;
                  return row;
                }}
                onKeepWaiting={(index) => {
                  void frames.keepWaiting(index).then((row) => {
                    if (row) changed.current = true;
                  });
                }}
              />
              <DialogFooter className="mt-4 max-sm:rounded-b-none max-sm:pb-10">
                <Button
                  type="button"
                  onClick={() => onClose(changed.current || busy)}
                >
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
