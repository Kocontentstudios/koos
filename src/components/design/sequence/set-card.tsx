"use client";

import { GalleryHorizontal, Presentation, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  coverOf,
  type DesignSet,
  frameSize,
  frameState,
  isBuilding,
  kindNoun,
  slideCount,
} from "./set-model";
import type { LiveSetJob } from "./use-set-watch";

/**
 * A set of ours still being made that has no frame to put on a card yet:
 * a placeholder in the frame's shape, saying where the job is, so the grid
 * is not silent while the set it was promised is on its way.
 */
export function SetBuildingCard({ job }: { job: LiveSetJob }) {
  const noun = job.kind ? kindNoun(job.kind) : "slides";
  const where =
    job.rendering && job.frameCount
      ? `Frame ${Math.min(job.done + 1, job.frameCount)} of ${job.frameCount}…`
      : "Planning…";
  return (
    <div
      role="status"
      data-set-building={job.jobId}
      className="relative block pt-2 pr-2"
    >
      <span
        className="relative block overflow-hidden rounded-lg border"
        style={{
          borderColor: "var(--border)",
          aspectRatio: job.kind === "presentation" ? "16 / 9" : "4 / 5",
        }}
      >
        <Skeleton className="absolute inset-0 rounded-none" />
        <span className="absolute inset-x-2 bottom-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--status-progress-bg)] px-2 py-1 text-[11px] font-semibold text-[var(--status-progress-fg)]">
          <Spinner className="size-3" />
          <span>
            Making your {noun}. {where}
          </span>
        </span>
      </span>
    </div>
  );
}

/* What the card's face shows when no frame has a picture yet. */
function CoverlessFace({
  building,
  noun,
}: {
  building: boolean;
  noun: string;
}) {
  if (building) {
    return (
      <>
        <Skeleton className="absolute inset-0 rounded-none" />
        <span className="absolute inset-x-2 top-1/2 -translate-y-1/2 text-center text-[12px] font-medium text-[var(--text-secondary)]">
          Making your {noun}…
        </span>
      </>
    );
  }
  /* Recessed fill and a dashed edge, as a failed frame has in the viewer:
     the card's own surface is the page's white in light mode. */
  return (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[var(--surface-container-low)] px-3 text-center">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-2 rounded-md border-2 border-dashed"
        style={{ borderColor: "var(--border-control)" }}
      />
      <TriangleAlert
        aria-hidden="true"
        className="relative size-5 text-[var(--status-error-fg)]"
      />
      <span className="relative text-[12px] font-semibold text-foreground">
        This {noun} didn&apos;t render
      </span>
      <span className="relative text-[11px] text-[var(--text-secondary)]">
        Open it to retry its frames
      </span>
    </span>
  );
}

/**
 * A whole carousel or presentation in the history grid: its hook frame on
 * top of a visible stack, with the slide count, so it reads as one thing
 * with more behind it rather than as one design among many. A set with no
 * picture yet keeps its card: a skeleton while it is being made, or a
 * stated failure that opens to its frames' retries.
 */
export function SetCard({
  set,
  onOpen,
}: {
  set: DesignSet;
  onOpen: (set: DesignSet) => void;
}) {
  const [hovered, setHovered] = useState(false);
  /* Set on error too: a broken cover must not leave the skeleton claiming
     it is still on its way. */
  const [coverShown, setCoverShown] = useState(false);
  const cover = coverOf(set);
  const coverUrl = cover?.url ?? null;

  const size = frameSize(set);
  const count = set.frames.length;
  const broken = set.frames.filter((slot) => {
    const state = frameState(slot);
    return state === "failed" || state === "missing";
  }).length;
  const Icon = set.kind === "carousel" ? GalleryHorizontal : Presentation;
  const noun = kindNoun(set.kind);
  const headline = set.frames[0]?.title || cover?.headline || "";
  const named = headline
    ? `Open ${noun}, ${slideCount(count)}: ${headline}`
    : `Open ${noun}, ${slideCount(count)}`;
  const building = isBuilding(set);
  const ready = set.frames.filter((s) => frameState(s) === "ready").length;
  const note = building
    ? `. Still being made, ${ready} of ${count} ready`
    : !coverUrl
      ? ". None of its frames rendered. Open it to retry them"
      : broken
        ? `. ${broken} didn't render`
        : "";

  return (
    <button
      type="button"
      onClick={() => onOpen(set)}
      aria-label={`${named}${note}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      data-set-card={set.setId}
      className="relative block pt-2 pr-2 text-left outline-none focus-visible:focus-outline rounded-lg"
    >
      {/* The two edges behind the cover are the deck itself: inline borders,
          since globals.css sets `* { border-color }` unlayered. */}
      <span
        aria-hidden="true"
        className="absolute top-0 right-0 bottom-2 left-2 rounded-lg border bg-[var(--surface-container-low)]"
        style={{ borderColor: "var(--border)" }}
      />
      <span
        aria-hidden="true"
        className="absolute top-1 right-1 bottom-1 left-1 rounded-lg border bg-[var(--surface-container)]"
        style={{ borderColor: "var(--border)" }}
      />
      {/* Sized from the frame before the cover arrives, so the grid never
          jumps when it loads. */}
      <span
        className="relative block overflow-hidden rounded-lg border bg-[var(--surface-container-lowest)] transition-colors"
        style={{
          borderColor: hovered ? "var(--border-accent)" : "var(--border)",
          aspectRatio: `${size.width} / ${size.height}`,
        }}
      >
        {coverUrl ? (
          <>
            {coverShown ? null : (
              <Skeleton className="absolute inset-0 rounded-none" />
            )}
            <Image
              src={coverUrl}
              alt=""
              width={size.width}
              height={size.height}
              onLoad={() => setCoverShown(true)}
              onError={() => setCoverShown(true)}
              className="relative block h-full w-full object-cover"
              unoptimized
            />
          </>
        ) : (
          <CoverlessFace building={building} noun={noun} />
        )}
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white">
          <Icon aria-hidden="true" className="size-3" />
          {slideCount(count)}
        </span>
        {building ? (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-[var(--status-progress-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--status-progress-fg)]">
            <Spinner className="size-3" />
            {ready} of {count}
          </span>
        ) : broken ? (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-[var(--status-error-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--status-error-fg)]">
            <TriangleAlert aria-hidden="true" className="size-3" />
            {broken} failed
          </span>
        ) : null}
      </span>
    </button>
  );
}
