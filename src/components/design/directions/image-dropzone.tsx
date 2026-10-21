"use client";

import { ImageUp, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DESIGN_IMAGE_ACCEPT, DESIGN_IMAGE_HINT } from "./flow-logic";
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

export function ImageDropzone({
  onFile,
  rejection = null,
  dragActive,
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errorId = useId();
  const inputId = useId();
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
      {/* The zone itself is not focusable: the Choose image button inside it
          is the keyboard path, so tab order has one stop, not two that do the
          same thing. */}
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
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
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors duration-150",
          active ? "bg-[var(--accent-glow)]" : "hover:bg-[var(--hover)]",
        )}
      >
        <span
          className={cn(
            "flex size-11 items-center justify-center rounded-full transition-colors",
            active
              ? "bg-primary text-primary-foreground"
              : "bg-[rgba(19,139,200,0.15)] text-primary",
          )}
        >
          <ImageUp aria-hidden="true" className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-[14px] font-semibold text-foreground">
            {active ? (
              "Drop to use this image"
            ) : (
              <>
                <PointerOnly>Drag your image here</PointerOnly>
                <TouchOnly>Add your image</TouchOnly>
              </>
            )}
          </p>
          <p id={hintId} className="text-[12px] text-[var(--text-muted)]">
            {DESIGN_IMAGE_HINT}.
            <PointerOnly> You can also paste one.</PointerOnly>
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          aria-describedby={rejection ? `${hintId} ${errorId}` : hintId}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          Choose image
        </Button>
        <input
          ref={inputRef}
          id={inputId}
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
      </label>
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
