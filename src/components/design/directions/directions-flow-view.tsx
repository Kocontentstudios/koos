"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import type { DesignEntry } from "@/components/design/design-analytics";
import type { GenerationStage } from "@/components/design/use-design-generation";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import type { SerializedGeneration } from "@/lib/design/serialize";
import type { JobStage } from "@/lib/generation/poll-job";
import { cn } from "@/lib/utils";
import { DirectionResults, type DirectionSlot } from "./direction-results";
import { FlowDescription, FlowTitle } from "./flow-heading";
import type { ImageSource } from "./flow-logic";
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
      label: string | null;
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
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    /* The sheet squares its bottom corners on phones and its -mb-4 pulls the
       footer flush to the edge; pb-10 keeps actions clear of the home bar. */
    <DialogFooter
      className={cn("mt-4 max-sm:rounded-b-none max-sm:pb-10", className)}
    >
      {children}
    </DialogFooter>
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
          label={view.label}
        />
      );

    case "error":
      return (
        <GenerationError
          message={view.message}
          unusableImage={view.unusableImage}
          onRetry={handlers.onRetryGeneration}
          onChooseAnotherImage={handlers.onChooseAnotherImage}
          onUseKoImagery={handlers.onLetKoCreate}
          onChangeImage={handlers.onBackToChoice}
        />
      );

    case "results":
      return (
        <>
          <Header
            title={
              view.slots.length > 0
                ? "Two directions to choose from"
                : "Your designs"
            }
            description={
              view.slots.length > 0
                ? "Each takes a different approach to the same brief. Download the one you like, send it to the design team, or regenerate either one."
                : "Designs from this run appear here."
            }
          />
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
            <Footer className="sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={handlers.onBackToChoice}
                disabled={view.regeneratingSlot !== null}
              >
                Change image
              </Button>
              <Button type="button" onClick={handlers.onDone}>
                Done
              </Button>
            </Footer>
          ) : null}
        </>
      );
  }
}
