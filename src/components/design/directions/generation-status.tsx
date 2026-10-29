"use client";

import { ImageOff, RotateCw, Sparkles, TriangleAlert } from "lucide-react";
import type { GenerationStage } from "@/components/design/use-design-generation";
import { Button } from "@/components/ui/button";
import { ProgressSteps } from "@/components/ui/progress-steps";
import { Spinner } from "@/components/ui/spinner";
import type { JobStage } from "@/lib/generation/poll-job";
import { FlowDescription, FlowTitle } from "./flow-heading";
import {
  generationStepIndex,
  generationSteps,
  type ImageSource,
  unusableImageReason,
} from "./flow-logic";

/** The client's own fetching label matches the last step's name; saying it
 *  twice in one status reads as a glitch. */
function sameWords(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[.…\s]+$/u, "").toLowerCase();
  return norm(a) === norm(b);
}

export interface GenerationProgressProps {
  source: ImageSource;
  stage: GenerationStage | null;
  /** The job's own stage; the steps follow this and nothing else. */
  jobStage: JobStage | null;
  progress: { done: number; total: number } | null;
  /** The worker's own words for what it is doing right now. */
  label: string | null;
}

/* While designs render, done/total counts them; it is the one stage where
   the count is real progress the user can watch. */
function renderCount(
  jobStage: JobStage | null,
  progress: { done: number; total: number } | null,
): string | null {
  if (jobStage !== "render" || !progress || progress.total <= 0) return null;
  return `${Math.min(progress.done, progress.total)} of ${progress.total} done`;
}

export function GenerationProgress({
  source,
  stage,
  jobStage,
  progress,
  label,
}: GenerationProgressProps) {
  const steps = generationSteps(source);
  const current = generationStepIndex(steps, stage, jobStage);
  const step = steps[current];
  const count = stage === "fetching" ? null : renderCount(jobStage, progress);

  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-[rgba(19,139,200,0.15)] text-primary-text">
        <Spinner className="size-6" />
      </span>
      <div className="flex flex-col items-center gap-1.5">
        <FlowTitle>Creating two directions</FlowTitle>
        <div role="status" className="flex flex-col items-center gap-1">
          <p className="text-[14px] font-medium text-foreground">
            {step.long}
            {count ? (
              <span className="text-[var(--text-secondary)]"> · {count}</span>
            ) : null}
            <span className="sr-only">
              , step {current + 1} of {steps.length}
            </span>
          </p>
          {label && !sameWords(label, step.long) ? (
            <p className="text-[12px] text-[var(--text-muted)]">{label}</p>
          ) : null}
        </div>
      </div>
      <div className="w-full max-w-[420px]" aria-hidden="true">
        <ProgressSteps steps={steps.map((s) => s.short)} current={current} />
      </div>
      <FlowDescription className="max-w-[420px] text-[12px] text-[var(--text-muted)]">
        This usually takes under a minute. Closing this won't stop it: finished
        designs also appear in Design Studio.
      </FlowDescription>
    </div>
  );
}

export interface GenerationErrorProps {
  message: string;
  /** The server refused the uploaded bytes, so retrying the same file is
   *  pointless and the way out is a different image. */
  unusableImage: boolean;
  onRetry: () => void;
  onChooseAnotherImage: () => void;
  onUseKoImagery: () => void;
  onChangeImage: () => void;
}

export function GenerationError({
  message,
  unusableImage,
  onRetry,
  onChooseAnotherImage,
  onUseKoImagery,
  onChangeImage,
}: GenerationErrorProps) {
  const Icon = unusableImage ? ImageOff : TriangleAlert;
  /* The server's sentence opens with the heading's own words; repeating them
     directly under the heading reads as a stutter. */
  const detail = unusableImage ? unusableImageReason(message) : message;
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 py-4 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-[var(--status-error-bg)] text-[var(--status-error-fg)]">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <div className="flex max-w-[440px] flex-col items-center gap-1.5">
        <FlowTitle>
          {unusableImage
            ? "This image can't be used"
            : "We couldn't finish your designs"}
        </FlowTitle>
        {detail ? <FlowDescription>{detail}</FlowDescription> : null}
        {unusableImage ? (
          <p className="text-[13px] text-[var(--text-secondary)]">
            Choose another image, or let KO create the imagery instead.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {unusableImage ? (
          <>
            <Button type="button" onClick={onChooseAnotherImage}>
              Choose another image
            </Button>
            <Button type="button" variant="secondary" onClick={onUseKoImagery}>
              <Sparkles aria-hidden="true" />
              Let KO create the imagery
            </Button>
          </>
        ) : (
          <>
            <Button type="button" onClick={onRetry}>
              <RotateCw aria-hidden="true" />
              Try again
            </Button>
            <Button type="button" variant="secondary" onClick={onChangeImage}>
              Change image
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
