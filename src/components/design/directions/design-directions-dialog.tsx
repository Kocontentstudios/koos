"use client";

import { useEffect, useRef, useState } from "react";
import {
  type DesignGenerationState,
  type DesignImageChoice,
  type GenerateArgs,
  useDesignGeneration,
} from "@/components/design/use-design-generation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { captureEvent } from "@/lib/analytics/posthog-client";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { cn } from "@/lib/utils";
import type { DirectionSlot } from "./direction-results";
import {
  type DirectionsEntry,
  DirectionsFlowView,
  type DirectionsHandlers,
  type DirectionsView,
  dialogWidthFor,
} from "./directions-flow-view";
import { FlowChromeProvider } from "./flow-heading";
import { type ImageSource, isUnusableImageError } from "./flow-logic";
import { useDesignImageUpload } from "./use-design-image-upload";

type Step = "choose" | "upload" | "run";

export interface DesignDirectionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: DirectionsEntry;
  /** Everything a run needs except the image, which this dialog chooses. */
  args: Omit<GenerateArgs, "image">;
  /** Owned by the caller when it also needs the results (Design Studio's
   *  history grid); created here otherwise. */
  design: DesignGenerationState;
  /** Fires whenever this dialog starts a billable run, including a single
   *  slot's regenerate, so the caller knows new designs may exist. */
  onRunStart?: () => void;
}

/**
 * A regenerated slot takes the new direction least like the card it sits
 * beside, so regenerating one direction does not produce a twin of the other.
 */
function pickReplacement(
  fresh: SerializedGeneration[],
  slot: number,
  neighbours: DirectionSlot[],
): SerializedGeneration | null {
  if (fresh.length === 0) return null;
  const taken = new Set(
    neighbours
      .filter((n, i) => i !== slot && n !== null)
      .map((n) => n?.direction?.title)
      .filter(Boolean),
  );
  return (
    fresh.find((g) => g.direction && !taken.has(g.direction.title)) ??
    fresh[Math.min(slot, fresh.length - 1)]
  );
}

export function DesignDirectionsDialog({
  open,
  onOpenChange,
  entry,
  args,
  design,
  onRunStart,
}: DesignDirectionsDialogProps) {
  const upload = useDesignImageUpload(args.brandId);
  /* A second run for one slot, separate from the main one so the other card
     stays on screen while it works. */
  const slotRun = useDesignGeneration();
  const [step, setStep] = useState<Step>("choose");
  const [source, setSource] = useState<ImageSource | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [waitingOnUpload, setWaitingOnUpload] = useState(false);
  const [replaced, setReplaced] = useState<
    Record<number, SerializedGeneration>
  >({});
  const [regeneratingSlot, setRegeneratingSlot] = useState<number | null>(null);
  const [regenerateError, setRegenerateError] = useState<{
    slot: number;
    message: string;
  } | null>(null);
  const lastImage = useRef<DesignImageChoice | null>(null);

  const baseSlots: DirectionSlot[] = [
    ...design.generations,
    ...Array.from({ length: design.failedCount }, () => null),
  ];
  const slots = baseSlots.map((slot, i) => replaced[i] ?? slot);

  function start(image: DesignImageChoice) {
    captureEvent("design_image_choice", { source: image.source });
    lastImage.current = image;
    setSource(image.source);
    setImageName(
      image.source === "upload" && upload.state.status !== "idle"
        ? upload.state.image.name
        : null,
    );
    setReplaced({});
    setRegeneratingSlot(null);
    setRegenerateError(null);
    slotRun.reset();
    setStep("run");
    onRunStart?.();
    void design.generate({ ...args, image });
  }

  /* "Use this image" pressed mid-upload continues on its own the moment the
     bytes are stored, so the user never has to press it twice. */
  const readyKey = upload.state.status === "ready" ? upload.state.key : null;
  /* start is re-created every render; only the upload finishing should
     trigger this, so it is deliberately left out of the dependencies. */
  useEffect(() => {
    if (waitingOnUpload && readyKey) {
      setWaitingOnUpload(false);
      start({ source: "upload", key: readyKey });
    }
  }, [waitingOnUpload, readyKey]);

  function backToChoice() {
    setWaitingOnUpload(false);
    design.reset();
    slotRun.reset();
    setStep("choose");
  }

  async function regenerate(slot: number) {
    const image = lastImage.current;
    if (!image) return;
    setRegeneratingSlot(slot);
    setRegenerateError(null);
    onRunStart?.();
    const fresh = await slotRun.generate({ ...args, image });
    const pick = pickReplacement(fresh, slot, slots);
    if (pick) {
      setReplaced((current) => ({ ...current, [slot]: pick }));
    } else {
      setRegenerateError({
        slot,
        message: slots[slot]
          ? "Regenerating didn't work, so this design is unchanged. Try again."
          : "Regenerating didn't work. Try again.",
      });
    }
    setRegeneratingSlot(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setStep("choose");
      setWaitingOnUpload(false);
      upload.clear();
      slotRun.reset();
      setReplaced({});
      setRegeneratingSlot(null);
      setRegenerateError(null);
    }
    onOpenChange(next);
  }

  const handlers: DirectionsHandlers = {
    onUseOwnImage: () => setStep("upload"),
    onLetKoCreate: () => start({ source: "ko" }),
    onFile: (file) => {
      setWaitingOnUpload(false);
      setStep("upload");
      upload.select(file);
    },
    onRemoveImage: () => {
      setWaitingOnUpload(false);
      upload.clear();
    },
    onRetryUpload: upload.retry,
    onUseImage: () => {
      if (upload.state.status === "ready") {
        start({ source: "upload", key: upload.state.key });
      } else {
        setWaitingOnUpload(true);
      }
    },
    onBackToChoice: backToChoice,
    onRetryGeneration: () => void design.retry(),
    onChooseAnotherImage: () => {
      design.reset();
      upload.clear();
      setStep("upload");
    },
    onRegenerate: (slot) => void regenerate(slot),
    onDone: () => handleOpenChange(false),
  };

  const view: DirectionsView =
    step === "choose"
      ? { step: "choose" }
      : step === "upload"
        ? {
            step: "upload",
            upload: upload.state,
            waitingOnUpload:
              waitingOnUpload &&
              (upload.state.status === "preparing" ||
                upload.state.status === "uploading"),
          }
        : design.pending
          ? {
              step: "progress",
              source: source ?? "ko",
              stage: design.stage,
              progress: design.progress,
              label: design.progressLabel,
            }
          : design.error
            ? {
                step: "error",
                source: source ?? "ko",
                message: design.error,
                unusableImage: isUnusableImageError(design.error),
              }
            : {
                step: "results",
                slots,
                source,
                imageName,
                regeneratingSlot,
                regenerateError,
              };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Bottom sheet on phones, as the design preview is: a design fills a
          small viewport, and covering the backdrop would remove
          tap-outside-to-dismiss. */}
      <DialogContent
        className={cn(
          "grid-rows-[minmax(0,1fr)] gap-0 sm:max-h-[92vh] max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[92vh] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:[&_[data-slot=dialog-close]]:size-11 [@media(hover:none)]:[&_[data-slot=dialog-close]]:size-11",
          dialogWidthFor(view),
        )}
      >
        {/* Scroll the contents, not the popup: the close button is positioned
            against the popup, so scrolling that carries the X off-screen. */}
        <div className="flex flex-col overflow-y-auto">
          <FlowChromeProvider value="dialog">
            <DirectionsFlowView entry={entry} view={view} handlers={handlers} />
          </FlowChromeProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
}
