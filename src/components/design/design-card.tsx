"use client";

import Image from "next/image";
import { useState } from "react";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { cn } from "@/lib/utils";

/**
 * One generated design in a grid.
 *
 * A button, not a link. The card used to BE the download link, with a
 * `download` attribute the browser ignores cross-origin — so clicking it
 * navigated to the raw PNG instead of saving it, and there was no way to reach
 * a preview at all. Saving now lives behind the preview, where the user can
 * see what they are about to save.
 */
export function DesignCard({
  generation,
  onOpen,
}: {
  generation: SerializedGeneration;
  onOpen: (generation: SerializedGeneration) => void;
}) {
  const [hovered, setHovered] = useState(false);

  if (!generation.url) return null;
  const label = generation.headline ?? generation.designType ?? "design";
  return (
    <button
      type="button"
      onClick={() => onOpen(generation)}
      aria-label={`Preview ${label}`}
      /* Inline, not a utility class: globals.css sets `* { border-color }`
         unlayered, which beats anything in @layer utilities — so a
         hover:border-* class here silently does nothing. This card is the only
         route into the preview, so it is the one control that needs the
         affordance to land. */
      style={{
        borderColor: hovered ? "var(--border-accent)" : "var(--border)",
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className={cn(
        "block overflow-hidden rounded-lg border transition-colors",
      )}
    >
      <Image
        src={generation.url}
        alt={generation.headline ?? "Generated design"}
        /* Only for the aspect box the browser reserves before the bytes land;
           a native variant older than the dimension fix still has none. */
        width={generation.width ?? 1080}
        height={generation.height ?? 1080}
        className="w-full"
        unoptimized
      />
    </button>
  );
}
