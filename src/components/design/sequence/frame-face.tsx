"use client";

import { ImageOff, RotateCw, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { type FrameSlot, frameState } from "./set-model";

export type Size = { width: number; height: number };

/** A frame being regenerated shows a placeholder, not its old picture, so
 *  the old frame is never mistaken for the new one. */
export type FaceMode = "frame" | "regenerating";

/* --surface-container-lowest is the card's own white in light mode, so a
   frame with nothing to show gets a recessed fill and a dashed outline, or
   it has no visible edge at all. Inline style, not a border utility:
   globals.css sets `* { border-color }` unlayered. */
function EmptyFace({
  compact,
  children,
}: {
  compact: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--surface-container-low)] px-4 text-center">
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute rounded-lg border-2 border-dashed",
          compact ? "inset-1 rounded-md border" : "inset-3",
        )}
        style={{ borderColor: "var(--border-control)" }}
      />
      {children}
    </div>
  );
}

type Load = "loading" | "shown" | "failed";

/* An expired signed URL fails the load; without onError the skeleton would
   stay up and keep claiming the frame is on its way. */
function FramePicture({
  url,
  alt,
  size,
  compact,
}: {
  url: string;
  alt: string;
  size: Size;
  compact: boolean;
}) {
  const [load, setLoad] = useState<Load>("loading");
  if (load === "failed") {
    return (
      <EmptyFace compact={compact}>
        <ImageOff
          aria-hidden="true"
          className="relative size-5 text-[var(--text-muted)]"
        />
        {compact ? (
          <span className="sr-only">Preview unavailable</span>
        ) : (
          <p className="relative text-[13px] font-medium text-[var(--text-secondary)]">
            Preview unavailable
          </p>
        )}
      </EmptyFace>
    );
  }
  return (
    <>
      {load === "loading" ? (
        compact ? (
          <Skeleton className="absolute inset-0 rounded-none" />
        ) : (
          <div role="status" className="absolute inset-0">
            <Skeleton className="absolute inset-0 rounded-none" />
            <span className="sr-only">Loading this frame…</span>
          </div>
        )
      ) : null}
      <Image
        src={url}
        alt={alt}
        width={size.width}
        height={size.height}
        draggable={false}
        onLoad={() => setLoad("shown")}
        onError={() => setLoad("failed")}
        className="relative block h-full w-full object-contain select-none"
        unoptimized
      />
    </>
  );
}

/**
 * What one frame shows, filling the box its parent sized: the frame itself,
 * a skeleton while it renders or regenerates, or a stated failure. `compact`
 * is the thumbnail, which says the same things in icons alone. `onRetry`
 * puts the retry on the failed frame itself, where the failure is.
 */
export function FrameFace({
  slot,
  alt,
  size,
  mode,
  compact = false,
  onRetry,
}: {
  slot: FrameSlot;
  alt: string;
  size: Size;
  mode: FaceMode;
  compact?: boolean;
  onRetry?: () => void;
}) {
  const state = frameState(slot);
  if (mode === "regenerating" || state === "rendering") {
    return (
      <>
        <Skeleton className="absolute inset-0 rounded-none" />
        {compact ? null : (
          <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-4 text-center text-[13px] font-medium text-[var(--text-secondary)]">
            {mode === "regenerating"
              ? "Making a new frame…"
              : "This frame is still rendering…"}
          </p>
        )}
      </>
    );
  }
  if (state === "failed" || state === "missing") {
    return (
      <EmptyFace compact={compact}>
        <TriangleAlert
          aria-hidden="true"
          className="relative size-5 text-[var(--status-error-fg)]"
        />
        {compact ? null : (
          <p className="relative max-w-[240px] text-[13px] leading-snug text-[var(--text-secondary)]">
            {state === "missing"
              ? "This frame was never made."
              : slot.stalled
                ? "This frame stopped before it finished."
                : "This frame didn't render."}
          </p>
        )}
        {!compact && state === "failed" && onRetry ? (
          <Button type="button" onClick={onRetry} className="relative">
            <RotateCw aria-hidden="true" />
            Retry frame {slot.index + 1}
          </Button>
        ) : null}
      </EmptyFace>
    );
  }
  const url = slot.generation?.url;
  if (!url) {
    return (
      <EmptyFace compact={compact}>
        <ImageOff
          aria-hidden="true"
          className="relative size-5 text-[var(--text-muted)]"
        />
        {compact ? null : (
          <p className="relative text-[13px] font-medium text-[var(--text-secondary)]">
            Preview unavailable
          </p>
        )}
      </EmptyFace>
    );
  }
  return <FramePicture url={url} alt={alt} size={size} compact={compact} />;
}
