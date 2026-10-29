"use client";

import { CircleCheck, RotateCw, TriangleAlert } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DESIGN_IMAGE_ACCEPT } from "@/lib/uploads/design-image-limits";
import { formatBytes, unusableImageReason } from "./flow-logic";
import type { DesignImageUpload } from "./use-design-image-upload";

type PickedState = Exclude<DesignImageUpload, { status: "idle" }>;

const FAILED_STEP_LEAD: Record<
  Extract<DesignImageUpload, { status: "error" }>["step"],
  string
> = {
  prepare: "This image can't be used.",
  presign: "The upload couldn't start.",
  upload: "The upload stopped part way.",
};

function StatusLine({ state }: { state: PickedState }) {
  const { image } = state;
  const size = [
    formatBytes(image.bytes),
    image.width && image.height ? `${image.width} × ${image.height} px` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (state.status === "error") {
    return <span className="text-[12px] text-[var(--text-muted)]">{size}</span>;
  }
  return (
    <span
      role="status"
      className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]"
    >
      {state.status === "ready" ? (
        <CircleCheck
          aria-hidden="true"
          className="size-3.5 text-[var(--status-ready-fg)]"
        />
      ) : (
        <Spinner className="size-3.5" />
      )}
      <span>
        {size}
        {" · "}
        {state.status === "preparing"
          ? "Preparing…"
          : state.status === "uploading"
            ? "Uploading…"
            : "Ready to use"}
      </span>
      {/* Outside the announcement: a live region re-reading every percent
          would talk over everything else. The progressbar carries the value. */}
      {state.status === "uploading" ? (
        <span aria-hidden="true" className="tabular-nums">
          {Math.round(state.fraction * 100)}%
        </span>
      ) : null}
    </span>
  );
}

export interface ImagePreviewProps {
  state: PickedState;
  onRemove: () => void;
  onReplace: (file: File) => void;
  onRetry: () => void;
}

export function ImagePreview({
  state,
  onRemove,
  onReplace,
  onRetry,
}: ImagePreviewProps) {
  const replaceRef = useRef<HTMLInputElement>(null);
  const { image } = state;
  const uploading = state.status === "uploading";

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="relative flex h-[min(320px,40vh)] items-center justify-center bg-[var(--surface-container-lowest)] p-4">
        <img
          src={image.previewUrl}
          alt={`Preview of ${image.name}`}
          className="max-h-full max-w-full rounded-md object-contain"
        />
        {uploading ? (
          <div
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.fraction * 100)}
            className="absolute inset-x-0 bottom-0 h-1 bg-[var(--border)]"
          >
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.max(4, state.fraction * 100)}%` }}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t p-3">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold text-foreground">
            {image.name}
          </span>
          <StatusLine state={state} />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => replaceRef.current?.click()}
          >
            Replace
          </Button>
          <input
            ref={replaceRef}
            type="file"
            accept={DESIGN_IMAGE_ACCEPT}
            tabIndex={-1}
            aria-hidden="true"
            data-testid="design-image-replace-input"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onReplace(file);
            }}
          />
        </div>
      </div>

      {state.status === "error" ? (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-3 border-t bg-[var(--status-error-bg)] p-3"
        >
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-[var(--status-error-fg)]"
          />
          <p className="min-w-0 flex-1 text-[13px] leading-snug text-foreground">
            <span className="font-semibold">
              {FAILED_STEP_LEAD[state.step]}
            </span>{" "}
            <span className="text-[var(--text-secondary)]">
              {state.step === "prepare"
                ? unusableImageReason(state.message)
                : state.message}
            </span>
          </p>
          {/* An unreadable file will not become readable on a second try;
              only a transport failure is worth retrying. */}
          {state.step === "prepare" ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => replaceRef.current?.click()}
            >
              Choose another
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRetry}
            >
              <RotateCw aria-hidden="true" />
              Try again
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
