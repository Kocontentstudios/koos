"use client";

import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";
import { trackImageChoice } from "@/components/design/design-analytics";
import { DesignPreviewModal } from "@/components/design/design-preview-modal";
import {
  sendGenerationToTeam,
  sentToTeamMessage,
  type TicketContext,
} from "@/components/design/send-to-team";
import {
  type DesignGenerationState,
  type DesignImageChoice,
  type GenerateArgs,
  useDesignGeneration,
} from "@/components/design/use-design-generation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { cn } from "@/lib/utils";
import type { DirectionSlot, SendNotice } from "./direction-results";
import {
  type DirectionsEntry,
  DirectionsFlowView,
  type DirectionsHandlers,
  type DirectionsView,
  dialogWidthFor,
} from "./directions-flow-view";
import { EscapeLayerProvider, useEscapeLayerStack } from "./escape-layer";
import { FlowChromeProvider } from "./flow-heading";
import { type ImageSource, isUnusableImageError } from "./flow-logic";
import { useKoImageryOffered } from "./ko-imagery-context";
import { useDesignImageUpload } from "./use-design-image-upload";

type Step = "choose" | "upload" | "run";

export interface DesignDirectionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: DirectionsEntry;
  /** Everything a run needs except the image, which this dialog chooses. */
  args: Omit<GenerateArgs, "image" | "regenerateOf">;
  /** Owned by the caller when it also needs the results (Design Studio's
   *  history grid); created here otherwise. */
  design: DesignGenerationState;
  /** Carried into a design ticket when a direction is sent to the team. */
  ticketContext?: TicketContext;
  /** Fires whenever this dialog starts a billable run, including a single
   *  slot's regenerate, so the caller knows new designs may exist. */
  onRunStart?: () => void;
}

export const DIRECTIONS_POPUP_CLASS =
  "grid-rows-[minmax(0,1fr)] gap-0 sm:max-h-[92vh] max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[92vh] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:[&_[data-slot=dialog-close]]:size-11 [@media(hover:none)]:[&_[data-slot=dialog-close]]:size-11";

/* Scroll the contents, not the popup: the close button is positioned against
   the popup, so scrolling that carries the X off-screen. The scroller spans
   the popup's padding (-m-4 p-4) because a scroll box clips whatever crosses
   its edge: flush with the content, it cut the 2px-offset focus outline off
   every edge control, and the footer could not bleed to the popup's edge.
   Padding does not stop the browser scrolling a newly focused control flush
   with the edge, which clipped its outline again; scroll-padding does. */
export const DIRECTIONS_SCROLL_CLASS =
  "-m-4 flex flex-col overflow-y-auto p-4 scroll-py-2";

function slotsOf(design: DesignGenerationState): DirectionSlot[] {
  return [
    ...design.generations.map((generation) => ({
      id: generation.id,
      generation,
    })),
    ...design.failedIds.map((id) => ({ id, generation: null })),
  ];
}

export function DesignDirectionsDialog({
  open,
  onOpenChange,
  entry,
  args,
  design,
  ticketContext,
  onRunStart,
}: DesignDirectionsDialogProps) {
  const upload = useDesignImageUpload(args.brandId);
  /* A second run for one slot, separate from the main one so the other card
     stays on screen while it works. */
  const slotRun = useDesignGeneration();
  const escapeLayers = useEscapeLayerStack();
  const koImagery = useKoImageryOffered();
  const [step, setStep] = useState<Step>("choose");
  const [source, setSource] = useState<ImageSource | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [waitingOnUpload, setWaitingOnUpload] = useState(false);
  /* Keyed by slot position: a regenerated direction takes the place of the
     one it was made from. */
  const [replaced, setReplaced] = useState<Record<number, DirectionSlot>>({});
  const [regeneratingSlot, setRegeneratingSlot] = useState<number | null>(null);
  const [regenerateError, setRegenerateError] = useState<{
    slot: number;
    message: string;
  } | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendNotices, setSendNotices] = useState<Record<string, SendNotice>>(
    {},
  );
  const lastImage = useRef<DesignImageChoice | null>(null);

  const slots = slotsOf(design).map((slot, i) => replaced[i] ?? slot);

  function clearRunState() {
    slotRun.reset();
    setReplaced({});
    setRegeneratingSlot(null);
    setRegenerateError(null);
    setSendNotices({});
  }

  function start(image: DesignImageChoice) {
    trackImageChoice(image.source, entry);
    lastImage.current = image;
    setSource(image.source);
    setImageName(
      image.source === "upload" && upload.state.status !== "idle"
        ? upload.state.image.name
        : null,
    );
    clearRunState();
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

  /* One new direction for one slot (regenerateOf), swapped in where the old
     one was. A failed slot keeps its row id, so it regenerates the same way.
     Not a new image choice, so no design_image_choice event.
     The contract is exactly one row back. Any other count means the server
     broke it, so the slot keeps its design and says so rather than guessing
     which of several rows belongs in it. */
  async function regenerate(slot: number) {
    const image = lastImage.current;
    const target = slots[slot];
    if (!image || !target) return;
    setRegeneratingSlot(slot);
    setRegenerateError(null);
    onRunStart?.();
    const rows = await slotRun.generate({
      ...args,
      image,
      regenerateOf: target.id,
    });
    const replacement = rows.length === 1 ? rows[0] : null;
    if (replacement) {
      setReplaced((current) => ({
        ...current,
        [slot]: { id: replacement.id, generation: replacement },
      }));
    } else {
      setRegenerateError({
        slot,
        message: target.generation
          ? "Regenerating didn't work, so this design is unchanged. Try again."
          : "Regenerating didn't work. Try again.",
      });
    }
    setRegeneratingSlot(null);
  }

  async function sendToTeam(generation: SerializedGeneration) {
    const notify = (notice: SendNotice) =>
      setSendNotices((current) => ({ ...current, [generation.id]: notice }));
    setSendingId(generation.id);
    setSendNotices(({ [generation.id]: _retried, ...rest }) => rest);
    try {
      const ticketNumber = await sendGenerationToTeam({
        brandId: args.brandId,
        generation,
        ticketContext,
      });
      notify({ tone: "sent", message: sentToTeamMessage(ticketNumber) });
    } catch (err) {
      notify({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Could not send to the design team.",
      });
    } finally {
      setSendingId((id) => (id === generation.id ? null : id));
    }
  }

  function handleOpenChange(
    next: boolean,
    details?: DialogPrimitive.Root.ChangeEventDetails,
  ) {
    if (
      !next &&
      details?.reason === "escape-key" &&
      escapeLayers.dismissInnermost()
    ) {
      details.cancel();
      return;
    }
    if (!next) {
      setStep("choose");
      setWaitingOnUpload(false);
      upload.clear();
      clearRunState();
    }
    onOpenChange(next);
  }

  const handlers: DirectionsHandlers = {
    onUseOwnImage: () => setStep("upload"),
    /* The view renders no KO choice while the flag is off; this guard keeps
       a stale handler from reaching a request the server would refuse. */
    onLetKoCreate: () => {
      if (koImagery) start({ source: "ko" });
    },
    onNoImage: () => start({ source: "none" }),
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
    onSendToTeam: (generation) => void sendToTeam(generation),
    onDone: () => handleOpenChange(false),
  };

  const finished = step === "run" && !design.pending && !design.error;

  /* Rows without a direction (from a server that has not shipped directions
     yet, or a run that fell back to the old path) have no title or reasons to
     fill a direction card with, so they open the preview they always did. */
  if (finished && design.generations.some((g) => !g.direction)) {
    const image = lastImage.current;
    return (
      <DesignPreviewModal
        open={open}
        onOpenChange={handleOpenChange}
        brandId={args.brandId}
        generations={design.generations}
        pending={false}
        progressLabel={null}
        error={null}
        partial={design.partial}
        onRetry={design.retry}
        onRegenerate={
          image
            ? () => {
                onRunStart?.();
                void design.generate({ ...args, image });
              }
            : undefined
        }
        ticketContext={ticketContext}
      />
    );
  }

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
              source: source ?? "none",
              stage: design.stage,
              jobStage: design.jobStage,
              progress: design.progress,
            }
          : design.error
            ? {
                step: "error",
                source: source ?? "none",
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
                sendingId,
                sendNotices,
              };

  /* A click beside the dialog is usually a slip, and closing resets the
     flow; it may only dismiss when nothing would be thrown away. Escape and
     the X stay deliberate ways out. */
  const pointerDismissable =
    view.step === "choose" ||
    (view.step === "upload" && view.upload.status === "idle") ||
    (view.step === "results" &&
      view.regeneratingSlot === null &&
      view.sendingId === null);

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      disablePointerDismissal={!pointerDismissable}
    >
      {/* Bottom sheet on phones, as the design preview is: a design fills a
          small viewport, and covering the backdrop would remove
          tap-outside-to-dismiss. */}
      <DialogContent
        className={cn(DIRECTIONS_POPUP_CLASS, dialogWidthFor(view))}
      >
        <div className={DIRECTIONS_SCROLL_CLASS}>
          <FlowChromeProvider value="dialog">
            <EscapeLayerProvider value={escapeLayers.stack}>
              <DirectionsFlowView
                entry={entry}
                view={view}
                handlers={handlers}
                koImagery={koImagery}
              />
            </EscapeLayerProvider>
          </FlowChromeProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
}
