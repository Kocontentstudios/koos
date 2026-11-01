"use client";

import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { trackImageChoice } from "@/components/design/design-analytics";
import { DesignPreviewModal } from "@/components/design/design-preview-modal";
import {
  sendGenerationToTeam,
  sentToTeamMessage,
  type TicketContext,
} from "@/components/design/send-to-team";
import {
  type OutlineRequest,
  useOutline,
} from "@/components/design/sequence/use-outline";
import {
  type DesignGenerationState,
  type DesignImageChoice,
  type GenerateArgs,
  useDesignGeneration,
} from "@/components/design/use-design-generation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  type ApprovedOutline,
  sequenceKindOf,
} from "@/lib/design/sequence/contract";
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
import { DiscardOutlineConfirm } from "./discard-outline-confirm";
import { EscapeLayerProvider, useEscapeLayerStack } from "./escape-layer";
import { FlowChromeProvider } from "./flow-heading";
import { type ImageSource, isUnusableImageError } from "./flow-logic";
import { useKoImageryOffered } from "./ko-imagery-context";
import { useMultiFrameOffered } from "./multi-frame-context";
import { useDesignImageUpload } from "./use-design-image-upload";

type Step = "choose" | "upload" | "outline" | "run";

export interface DesignDirectionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: DirectionsEntry;
  /** Everything a run needs except the image and, for a set, the outline,
   *  which this dialog chooses. */
  args: Omit<GenerateArgs, "image" | "regenerateOf" | "approvedOutline">;
  /** Owned by the caller when it also needs the results (Design Studio's
   *  history grid); created here otherwise. */
  design: DesignGenerationState;
  /** Carried into a design ticket when a direction is sent to the team. */
  ticketContext?: TicketContext;
  /** The format the server will read from `args`, when the caller knows it
   *  apart from a ticket (Design Studio, from its attached picker options).
   *  Falls back to the ticket's. */
  designType?: string | null;
  /** Fires whenever this dialog starts a billable run, including a single
   *  slot's regenerate, so the caller knows new designs may exist. */
  onRunStart?: () => void;
}

export const DIRECTIONS_POPUP_CLASS =
  "grid-rows-[minmax(0,1fr)] gap-0 sm:max-h-[92vh] max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[92vh] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:[&_[data-slot=dialog-close]]:size-11 [@media(hover:none)]:[&_[data-slot=dialog-close]]:size-11";

/* Scroll the contents, not the popup: the close button is positioned against
   the popup, so scrolling that carries the X off-screen. The scroller spans
   the popup's side and bottom padding (-mx-4 -mb-4, px-4 pb-4) because a
   scroll box clips whatever crosses its edge: flush with the content, it cut
   the 2px-offset focus outline off every edge control, and the footer could
   not bleed to the popup's edge. Its top edge sits at the close button's
   bottom (8px inset plus 28px, or 44px on a phone or touch screen), so a
   scrolled field never passes under the X and a tap meant for the field
   can't close the dialog. Padding does not stop the browser scrolling a
   newly focused control flush with the edge, which clipped its outline
   again; scroll-padding does. */
export const DIRECTIONS_SCROLL_CLASS =
  "-mx-4 -mb-4 mt-5 flex flex-col overflow-y-auto px-4 pt-2 pb-4 scroll-py-2 max-sm:mt-9 [@media(hover:none)]:mt-9";

const NO_FRAME_ACTIONS: ReadonlySet<string> = new Set();
const NO_FRAMES_WAITING: ReadonlySet<number> = new Set();

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
  designType,
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
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const lastImage = useRef<DesignImageChoice | null>(null);
  const multiFrame = useMultiFrameOffered();
  /* Studio hands over the attachments' design type and the brief and
     calendar entry points the ticket's; with FEATURE_MULTI_FRAME on, a
     carousel or presentation there is certain to be built as a set, so it
     stops at the outline. Otherwise the run is told nothing, exactly as
     before, and learns it is a set from the job's own progress. */
  const expectedKind = multiFrame
    ? sequenceKindOf(designType ?? ticketContext?.designType)
    : null;
  const {
    brandId,
    briefId,
    calendarItemId,
    attachments,
    freeform,
    aspectRatio,
  } = args;
  const outlineRequest = useMemo<OutlineRequest>(
    () => ({
      brandId,
      briefId,
      calendarItemId,
      attachments,
      freeform,
      aspectRatio,
    }),
    [brandId, briefId, calendarItemId, attachments, freeform, aspectRatio],
  );
  /* Only a set the server is certain to build gets an outline step; the
     kind passed when there is none is never read. */
  const outline = useOutline(expectedKind ?? "carousel", outlineRequest);
  /* Set when the run on screen was started from an approved outline, so
     its error offers the way back to that outline. */
  const [fromOutline, setFromOutline] = useState(false);

  function run(runArgs: GenerateArgs) {
    if (expectedKind) {
      void design.generate(runArgs, { sequenceKind: expectedKind });
    } else {
      void design.generate(runArgs);
    }
  }

  const slots = slotsOf(design).map((slot, i) => replaced[i] ?? slot);

  function clearRunState() {
    slotRun.reset();
    setReplaced({});
    setRegeneratingSlot(null);
    setRegenerateError(null);
    setSendNotices({});
  }

  /* A carousel or presentation stops at its outline first: the user
     approves the points before any copy is written or unit spent. The
     outline already on screen is kept, so changing the image never throws
     the user's edits away. */
  function start(image: DesignImageChoice) {
    trackImageChoice(image.source, entry);
    lastImage.current = image;
    setSource(image.source);
    setImageName(
      image.source === "upload" && upload.state.status !== "idle"
        ? upload.state.image.name
        : null,
    );
    if (expectedKind) {
      setStep("outline");
      return;
    }
    launch(image);
  }

  function launch(image: DesignImageChoice, approvedOutline?: ApprovedOutline) {
    clearRunState();
    setFromOutline(approvedOutline !== undefined);
    setStep("run");
    onRunStart?.();
    run(
      approvedOutline
        ? { ...args, image, approvedOutline }
        : { ...args, image },
    );
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

  /* Closing resets the flow, and an edited outline can't be got back: a new
     plan costs another rate-limited call and says something different. The
     outline outlives its own step (Back to change the image keeps it, and a
     failed run offers Edit outline), so the guard follows the draft, not the
     step. Once a run has the outline and is not failing, it is spent. */
  const outlineStillNeeded =
    step !== "run" || (fromOutline && !design.pending && !!design.error);
  const outlineAtRisk =
    outline.state.status === "ready" &&
    outline.state.draft.edited &&
    outlineStillNeeded;

  function closeFlow() {
    setStep("choose");
    setWaitingOnUpload(false);
    upload.clear();
    outline.reset();
    setFromOutline(false);
    setConfirmingDiscard(false);
    clearRunState();
    onOpenChange(false);
  }

  function handleOpenChange(
    next: boolean,
    details?: DialogPrimitive.Root.ChangeEventDetails,
  ) {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (details?.reason === "escape-key" && escapeLayers.dismissInnermost()) {
      details.cancel();
      return;
    }
    if (outlineAtRisk) {
      details?.cancel();
      setConfirmingDiscard(true);
      return;
    }
    closeFlow();
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
    onGenerateOutline: (approved) => {
      const image = lastImage.current;
      if (image) launch(image, approved);
    },
    onEditOutline: fromOutline
      ? () => {
          design.reset();
          setStep("outline");
        }
      : undefined,
    onRetryGeneration: () => void design.retry(),
    onChooseAnotherImage: () => {
      design.reset();
      upload.clear();
      setStep("upload");
    },
    onRegenerate: (slot) => void regenerate(slot),
    onSendToTeam: (generation) => void sendToTeam(generation),
    /* Each frame is its own billed job, so the caller hears of it as a run,
       the same as a slot regenerate. */
    onRegenerateFrame: async (generationId, edits) => {
      onRunStart?.();
      return (await design.regenerateFrame?.(generationId, edits)) ?? null;
    },
    onKeepWaitingOnFrame: (index) => {
      void design.keepWaitingOnFrame?.(index);
    },
    onDone: () => handleOpenChange(false),
  };

  const finished = step === "run" && !design.pending && !design.error;

  /* Rows without a direction (from a server that has not shipped directions
     yet, or a run that fell back to the old path) have no title or reasons to
     fill a direction card with, so they open the preview they always did. A
     set's frames carry no reasons either, but a set always opens the set
     viewer. */
  if (finished && !design.set && design.generations.some((g) => !g.direction)) {
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
                run({ ...args, image });
              }
            : undefined
        }
        ticketContext={ticketContext}
      />
    );
  }

  /* The outline stays on screen while the server takes the run, so its
     Generate button shows that wait. */
  const outlineHandingOff =
    step === "run" && fromOutline && design.pending && design.posting === true;

  const view: DirectionsView =
    step === "outline" || outlineHandingOff
      ? { step: "outline", outline, starting: outlineHandingOff }
      : step === "choose"
        ? { step: "choose", setKind: expectedKind }
        : step === "upload"
          ? {
              step: "upload",
              setKind: expectedKind,
              upload: upload.state,
              waitingOnUpload:
                waitingOnUpload &&
                (upload.state.status === "preparing" ||
                  upload.state.status === "uploading"),
            }
          : design.pending && design.sequenceProgress
            ? {
                step: "set-progress",
                progress: design.sequenceProgress,
                stage: design.stage,
                source: source ?? "none",
              }
            : design.pending
              ? {
                  step: "progress",
                  source: source ?? "none",
                  stage: design.stage,
                  jobStage: design.jobStage,
                  progress: design.progress,
                }
              : design.error && design.stillRunning
                ? { step: "still-running", message: design.error }
                : design.error
                  ? {
                      step: "error",
                      source: source ?? "none",
                      message: design.error,
                      unusableImage: isUnusableImageError(design.error),
                    }
                  : design.set
                    ? {
                        step: "set-results",
                        set: design.set,
                        source,
                        frameActions: design.frameActions ?? NO_FRAME_ACTIONS,
                        frameErrors: design.frameErrors ?? {},
                        framesStillRunning:
                          design.framesStillRunning ?? NO_FRAMES_WAITING,
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
     flow; it may only dismiss when nothing would be thrown away. An edited
     outline is guarded by the confirm on every other path, so a slip there
     asks nothing. */
  const pointerDismissable =
    !outlineAtRisk &&
    (view.step === "choose" ||
      (view.step === "upload" && view.upload.status === "idle") ||
      (view.step === "results" &&
        view.regeneratingSlot === null &&
        view.sendingId === null) ||
      (view.step === "set-results" && view.frameActions.size === 0) ||
      (view.step === "outline" && !view.starting));

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
        <DiscardOutlineConfirm
          open={confirmingDiscard}
          onKeep={() => setConfirmingDiscard(false)}
          onDiscard={closeFlow}
        />
      </DialogContent>
    </Dialog>
  );
}
