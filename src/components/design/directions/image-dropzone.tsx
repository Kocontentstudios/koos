"use client";

import { ImageUp, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  DESIGN_IMAGE_ACCEPT,
  DESIGN_IMAGE_SUMMARY,
} from "@/lib/uploads/design-image-limits";
import { cn } from "@/lib/utils";
import { PointerOnly, TouchOnly } from "./input-modality";

export interface ImageDropzoneProps {
  onFile: (file: File) => void;
  /** Why the last file was refused before upload, shown under the zone. */
  rejection?: string | null;
  /** Forces the drop-target look; the preview harness has no drag to show. */
  dragActive?: boolean;
}

function firstImage(list: FileList | null | undefined): File | null {
  return list && list.length > 0 ? list[0] : null;
}

/**
 * Drop target and file picker in one control: the whole zone is a single
 * button, so the click target is the full area and the keyboard path is one
 * Tab stop with a visible outline, not a zone plus a button inside it that do
 * the same thing.
 */
export function ImageDropzone({
  onFile,
  rejection = null,
  dragActive,
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errorId = useId();
  const [dragging, setDragging] = useState(false);
  const active = dragActive ?? dragging;

  /* A screenshot on the clipboard is one keystroke away from being the
     design's image; making the user save it to disk first is three more steps. */
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const file = firstImage(e.clipboardData?.files);
      if (!file) return;
      e.preventDefault();
      onFile(file);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onFile]);

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={DESIGN_IMAGE_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        data-testid="design-image-input"
        className="sr-only"
        onChange={(e) => {
          const file = firstImage(e.target.files);
          /* Cleared so picking the same file again after a Remove still
             fires a change event. */
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
      <button
        type="button"
        aria-label="Choose image"
        aria-describedby={rejection ? `${hintId} ${errorId}` : hintId}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = firstImage(e.dataTransfer.files);
          if (file) onFile(file);
        }}
        data-drag-active={active || undefined}
        /* Inline, not a border utility: globals.css sets `* { border-color }`
           unlayered, which beats every border-* utility class. */
        style={{
          borderColor: active
            ? "var(--primary)"
            : rejection
              ? "var(--status-error-fg)"
              : "var(--border-control)",
        }}
        className={cn(
          "group flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors duration-150 focus-visible:focus-outline",
          active ? "bg-[var(--accent-glow)]" : "hover:bg-[var(--hover)]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex size-11 items-center justify-center rounded-full transition-colors",
            active
              ? "bg-primary-fill text-primary-foreground"
              : "bg-[rgba(19,139,200,0.15)] text-primary-text",
          )}
        >
          <ImageUp className="size-5" />
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-[14px] font-semibold text-foreground">
            {active ? (
              "Drop to use this image"
            ) : (
              <>
                <PointerOnly>Drag your image here</PointerOnly>
                <TouchOnly>Add your image</TouchOnly>
              </>
            )}
          </span>
          <span id={hintId} className="text-[12px] text-[var(--text-muted)]">
            {DESIGN_IMAGE_SUMMARY}.
            <PointerOnly> You can also paste one.</PointerOnly>
          </span>
        </span>
        {/* Looks like a button so the zone reads as clickable at a glance;
            the zone itself is the control. */}
        <span
          aria-hidden="true"
          className={cn(
            buttonVariants({ variant: "secondary" }),
            "pointer-events-none",
          )}
        >
          Choose image
        </span>
      </button>
      {rejection ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-[12px] text-[var(--status-error-fg)]"
        >
          <TriangleAlert
            aria-hidden="true"
            className="mt-px size-3.5 shrink-0"
          />
          {rejection}
        </p>
      ) : null}
    </div>
  );
}
