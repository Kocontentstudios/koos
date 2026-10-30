"use client";

import { GalleryHorizontal, Presentation, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import {
  coverOf,
  type DesignSet,
  frameSize,
  frameState,
  kindNoun,
  slideCount,
} from "./set-model";

/**
 * A whole carousel or presentation in the history grid: its hook frame on
 * top of a visible stack, with the slide count, so it reads as one thing
 * with more behind it rather than as one design among many.
 */
export function SetCard({
  set,
  onOpen,
}: {
  set: DesignSet;
  onOpen: (set: DesignSet) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const cover = coverOf(set);
  if (!cover?.url) return null;

  const size = frameSize(set);
  const count = set.frames.length;
  const broken = set.frames.filter((slot) => {
    const state = frameState(slot);
    return state === "failed" || state === "missing";
  }).length;
  const Icon = set.kind === "carousel" ? GalleryHorizontal : Presentation;
  const noun = kindNoun(set.kind);
  const headline = set.frames[0]?.title || cover.headline || noun;

  return (
    <button
      type="button"
      onClick={() => onOpen(set)}
      aria-label={`Open ${noun}, ${slideCount(count)}: ${headline}${
        broken ? `. ${broken} didn't render` : ""
      }`}
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
      <span
        className="relative block overflow-hidden rounded-lg border transition-colors"
        style={{
          borderColor: hovered ? "var(--border-accent)" : "var(--border)",
        }}
      >
        <Image
          src={cover.url}
          alt=""
          width={size.width}
          height={size.height}
          className="w-full"
          unoptimized
        />
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white">
          <Icon aria-hidden="true" className="size-3" />
          {slideCount(count)}
        </span>
        {broken ? (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-[var(--status-error-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--status-error-fg)]">
            <TriangleAlert aria-hidden="true" className="size-3" />
            {broken} failed
          </span>
        ) : null}
      </span>
    </button>
  );
}
