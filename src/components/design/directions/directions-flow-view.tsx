"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { DesignEntry } from "@/components/design/design-analytics";
import type { GenerationStage } from "@/components/design/use-design-generation";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import type { SerializedGeneration } from "@/lib/design/serialize";
import type { JobStage } from "@/lib/generation/poll-job";
import { cn } from "@/lib/utils";
import { DirectionResults, type DirectionSlot } from "./direction-results";
import { useEscapeLayer } from "./escape-layer";
import { FlowDescription, FlowTitle } from "./flow-heading";
import { type ImageSource, resultsHeading, startOverLabel } from "./flow-logic";
import { GenerationError, GenerationProgress } from "./generation-status";
import { ImageChoice } from "./image-choice";
import { ImageDropzone } from "./image-dropzone";
import { ImagePreview } from "./image-preview";
import type { DesignImageUpload } from "./use-design-image-upload";

export type DirectionsEntry = DesignEntry;

export type DirectionsView =
  | { step: "choose" }
  | {
      step: "upload";
      upload: DesignImageUpload;
      /** "Use this image" was pressed before the upload finished. */
      waitingOnUpload: boolean;
      /** Forces the drop-target look where no real drag can be shown. */
      dragActive?: boolean;
    }
  | {
      step: "progress";
      source: ImageSource;
      stage: GenerationStage | null;
      jobStage: JobStage | null;
      progress: { done: number; total: number } | null;
    }
  | {
      step: "error";
      source: ImageSource;
      message: string;
      unusableImage: boolean;
    }
  | {
      step: "results";
      slots: DirectionSlot[];
      source: ImageSource | null;
      imageName: string | null;
      regeneratingSlot: number | null;
      regenerateError: { slot: number; message: string } | null;
      sendingId: string | null;
    };

export interface DirectionsHandlers {
  onUseOwnImage: () => void;
  onLetKoCreate: () => void;
  onFile: (file: File) => void;
  onRemoveImage: () => void;
  onRetryUpload: () => void;
  onUseImage: () => void;
  onBackToChoice: () => void;
  onRetryGeneration: () => void;
  onChooseAnotherImage: () => void;
  onRegenerate: (slot: number) => void;
  onSendToTeam: (generation: SerializedGeneration) => void;
  onDone: () => void;
}

const CHOOSE_TITLE: Record<DirectionsEntry, string> = {
  calendar: "Choose the image for this post",
  brief: "Choose imagery for this design",
  studio: "Choose imagery for this design",
};

/** The dialog widens for results so two portrait designs sit side by side. */
export function dialogWidthFor(view: DirectionsView): string {
  return view.step === "results" ? "sm:max-w-5xl" : "sm:max-w-xl";
}

function Header({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 pr-8 pb-4 max-sm:pr-14 [@media(hover:none)]:pr-14">
      <FlowTitle>{title}</FlowTitle>
      <FlowDescription>{description}</FlowDescription>
    </div>
  );
}

function Footer({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    /* The sheet squares its bottom corners on phones and its -mb-4 pulls the
       footer flush to the edge; pb-10 keeps actions clear of the home bar. */
    <DialogFooter
      className={cn("mt-4 max-sm:rounded-b-none max-sm:pb-10", className)}
      {...props}
    >
      {children}
    </DialogFooter>
  );
}

/**
 * Leaving results clears them from this dialog, so with designs on screen it
 * asks first and says where they will still be. The designs are never lost
 * (every run is saved to Design Studio), which is why this is a confirm in
 * the footer rather than a destructive-action dialog.
 */
function ResultsFooter({
  source,
  designsOnScreen,
  regenerating,
  onStartOver,
  onDone,
}: {
  source: ImageSource | null;
  designsOnScreen: boolean;
  regenerating: boolean;
  onStartOver: () => void;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useEscapeLayer(confirming, () => setConfirming(false));
  const promptId = useId();
  const stayRef = useRef<HTMLButtonElement>(null);
  const startOverRef = useRef<HTMLButtonElement>(null);
  /* The button that was pressed disappears, so focus is placed by hand both
     ways; without it, focus falls to the dialog and a keyboard user is lost.
     Compared with the last value, not skipped on first run, so a Strict Mode
     re-run of the effect never steals focus on mount. */
  const shown = useRef(confirming);
  useEffect(() => {
    if (shown.current === confirming) return;
    shown.current = confirming;
    (confirming ? stayRef : startOverRef).current?.focus();
  }, [confirming]);

  const label = startOverLabel(source);

  if (confirming) {
    return (
      <Footer
        role="group"
        aria-labelledby={promptId}
        className="flex-col sm:flex-row sm:items-center sm:justify-between"
      >
        <p
          id={promptId}
          className="text-[13px] leading-snug text-[var(--text-secondary)]"
        >
          <span className="font-semibold text-foreground">{label}?</span> These
          designs stay in Design Studio.
        </p>
        <div className="flex gap-2 max-sm:flex-col-reverse">
          <Button
            ref={stayRef}
            type="button"
            variant="ghost"
            onClick={() => setConfirming(false)}
          >
            Stay here
          </Button>
          <Button type="button" onClick={onStartOver} disabled={regenerating}>
            {label}
          </Button>
        </div>
      </Footer>
    );
  }

  return (
    <Footer className="sm:justify-between">
      <Button
        ref={startOverRef}
        type="button"
        variant="ghost"
        onClick={designsOnScreen ? () => setConfirming(true) : onStartOver}
        disabled={regenerating}
      >
        {label}
      </Button>
      <Button type="button" onClick={onDone}>
        Done
      </Button>
    </Footer>
  );
}

export function DirectionsFlowView({
  entry,
  view,
  handlers,
}: {
  entry: DirectionsEntry;
  view: DirectionsView;
  handlers: DirectionsHandlers;
}) {
  switch (view.step) {
    case "choose":
      return (
        <>
          <Header
            title={CHOOSE_TITLE[entry]}
            description="Use your own image or let KO create it. Either way you get two different design directions to pick from."
          />
          <ImageChoice
            onUseOwnImage={handlers.onUseOwnImage}
            onLetKoCreate={handlers.onLetKoCreate}
            onFileDropped={handlers.onFile}
          />
        </>
      );

    case "upload": {
      const { upload } = view;
      const canUse = upload.status !== "idle" && upload.status !== "error";
      return (
        <>
          <Header
            title="Upload your image"
            description="KO keeps your image exactly as it is and designs two directions around it."
          />
          {upload.status === "idle" ? (
            <ImageDropzone
              onFile={handlers.onFile}
              rejection={upload.rejection}
              dragActive={view.dragActive}
            />
          ) : (
            <ImagePreview
              state={upload}
              onRemove={handlers.onRemoveImage}
              onReplace={handlers.onFile}
              onRetry={handlers.onRetryUpload}
            />
          )}
          <Footer className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={handlers.onBackToChoice}
            >
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
            {upload.status === "idle" ? null : (
              <Button
                type="button"
                onClick={handlers.onUseImage}
                disabled={!canUse}
                loading={view.waitingOnUpload}
                loadingText="Finishing upload…"
              >
                Use this image
                <ArrowRight aria-hidden="true" />
              </Button>
            )}
          </Footer>
        </>
      );
    }

    case "progress":
      return (
        <GenerationProgress
          source={view.source}
          stage={view.stage}
          jobStage={view.jobStage}
          progress={view.progress}
        />
      );

    case "error":
      return (
        <GenerationError
          message={view.message}
          source={view.source}
          unusableImage={view.unusableImage}
          onRetry={handlers.onRetryGeneration}
          onChooseAnotherImage={handlers.onChooseAnotherImage}
          onUseKoImagery={handlers.onLetKoCreate}
          onChangeImage={handlers.onBackToChoice}
        />
      );

    case "results": {
      const ready = view.slots.filter((slot) => slot.generation).length;
      const heading = resultsHeading(ready, view.slots.length);
      return (
        <>
          <Header title={heading.title} description={heading.description} />
          <DirectionResults
            slots={view.slots}
            source={view.source}
            imageName={view.imageName}
            regeneratingSlot={view.regeneratingSlot}
            regenerateError={view.regenerateError}
            sendingId={view.sendingId}
            onRegenerate={handlers.onRegenerate}
            onSendToTeam={handlers.onSendToTeam}
            onChooseImagery={handlers.onBackToChoice}
          />
          {view.slots.length > 0 ? (
            <ResultsFooter
              source={view.source}
              designsOnScreen={ready > 0}
              regenerating={view.regeneratingSlot !== null}
              onStartOver={handlers.onBackToChoice}
              onDone={handlers.onDone}
            />
          ) : null}
        </>
      );
    }
  }
}
