"use client";

import { Check } from "lucide-react";
import {
  FlowDescription,
  FlowTitle,
} from "@/components/design/directions/flow-heading";
import type { ImageSource } from "@/components/design/directions/flow-logic";
import type { GenerationStage } from "@/components/design/use-design-generation";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  currentFrame,
  type SequenceProgress,
  sequenceProgressLine,
  setNoun,
} from "./progress";

type TileState = "done" | "current" | "waiting";

function tileState(progress: SequenceProgress, index: number): TileState {
  if (progress.phase === "plan") return "waiting";
  if (index < progress.done) return "done";
  return index === currentFrame(progress) - 1 ? "current" : "waiting";
}

/**
 * The wait for a whole set: one tile per frame, in the shape the frames will
 * have, filling in as each one is delivered. The tiles are the picture; the
 * status line is what a screen reader hears.
 */
function titleOf(progress: SequenceProgress): string {
  const noun = setNoun(progress);
  if (!progress.frameCount) return `Making your ${noun}`;
  return progress.kind
    ? `Making your ${progress.frameCount}-slide ${noun}`
    : `Making your ${progress.frameCount} slides`;
}

/* KO paints a picture for every frame, and a set of them runs as several
   210s slices; drawn on an upload or on type alone a frame is a render. No
   figure is promised for the second: it depends on the count. */
function durationNote(source: ImageSource): string | null {
  return source === "ko"
    ? "KO paints a picture for every frame, so this can take several minutes."
    : null;
}

export function SetProgress({
  progress,
  stage,
  source,
}: {
  progress: SequenceProgress;
  stage: GenerationStage | null;
  source: ImageSource;
}) {
  const noun = setNoun(progress);
  const line =
    stage === "fetching"
      ? `Getting your ${noun} ready…`
      : sequenceProgressLine(progress);
  const ratio = progress.kind === "presentation" ? "16 / 9" : "4 / 5";
  const duration = durationNote(source);

  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-[rgba(19,139,200,0.15)] text-primary-text">
        <Spinner className="size-6" />
      </span>
      <div className="flex flex-col items-center gap-1.5">
        <FlowTitle>{titleOf(progress)}</FlowTitle>
        <p role="status" className="text-[14px] text-[var(--text-secondary)]">
          {line}
        </p>
      </div>
      <ol
        aria-hidden="true"
        className="flex max-w-full flex-wrap justify-center gap-1.5"
      >
        {Array.from({ length: progress.frameCount ?? 0 }, (_, index) => {
          const state = tileState(progress, index);
          return (
            <li
              key={index}
              data-tile={state}
              className={cn(
                "relative overflow-hidden rounded-md border-2",
                progress.kind === "presentation" ? "w-14" : "w-9",
              )}
              style={{
                aspectRatio: ratio,
                borderColor:
                  state === "current"
                    ? "var(--border-accent)"
                    : state === "done"
                      ? "transparent"
                      : "var(--border-control)",
                borderStyle: state === "waiting" ? "dashed" : "solid",
              }}
            >
              {state === "done" ? (
                <span className="absolute inset-0 flex items-center justify-center bg-[var(--status-ready-bg)] text-[var(--status-ready-fg)]">
                  <Check className="size-4" />
                </span>
              ) : state === "current" ? (
                <Skeleton className="absolute inset-0 rounded-none" />
              ) : null}
            </li>
          );
        })}
      </ol>
      <FlowDescription className="max-w-[420px] text-[12px] text-[var(--text-muted)]">
        {duration ? `${duration} ` : null}
        Closing this won't stop it: Design Studio picks it up and shows each
        frame as it lands.
      </FlowDescription>
    </div>
  );
}
