"use client";

import { Check } from "lucide-react";
import {
  FlowDescription,
  FlowTitle,
} from "@/components/design/directions/flow-heading";
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
export function SetProgress({
  progress,
  stage,
}: {
  progress: SequenceProgress;
  stage: GenerationStage | null;
}) {
  const noun = setNoun(progress);
  const line =
    stage === "fetching"
      ? `Getting your ${noun} ready…`
      : sequenceProgressLine(progress);
  const title = progress.kind
    ? `Making your ${progress.frameCount}-slide ${noun}`
    : `Making your ${progress.frameCount} slides`;
  const ratio = progress.kind === "presentation" ? "16 / 9" : "4 / 5";

  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-[rgba(19,139,200,0.15)] text-primary-text">
        <Spinner className="size-6" />
      </span>
      <div className="flex flex-col items-center gap-1.5">
        <FlowTitle>{title}</FlowTitle>
        <p role="status" className="text-[14px] text-[var(--text-secondary)]">
          {line}
        </p>
      </div>
      <ol
        aria-hidden="true"
        className="flex max-w-full flex-wrap justify-center gap-1.5"
      >
        {Array.from({ length: progress.frameCount }, (_, index) => {
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
        Each frame takes a few seconds. Closing this won't stop it: finished
        frames also appear in Design Studio.
      </FlowDescription>
    </div>
  );
}
