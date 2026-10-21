"use client";

import {
  Download,
  ImageOff,
  RefreshCw,
  Send,
  TriangleAlert,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { cn } from "@/lib/utils";

const FALLBACK_SIZE = { width: 1080, height: 1350 };

type Size = { width: number; height: number };

function sizeOf(generation: SerializedGeneration | null): Size {
  return generation?.width && generation.height
    ? { width: generation.width, height: generation.height }
    : FALLBACK_SIZE;
}

function Eyebrow({ index }: { index: number }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
      Direction {index + 1}
    </p>
  );
}

/** The design's own box at its own aspect ratio, full card width, so every
 *  state of a slot (loading, shown, unavailable, regenerating) is the same
 *  size and the cards never jump. */
function DesignFrame({
  size,
  className,
  children,
}: {
  size: Size;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative w-full bg-[var(--surface-container-lowest)]",
        className,
      )}
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      {children}
    </div>
  );
}

/** Replaces the design while a new one is made for this slot, so the old
 *  design is never mistaken for the result. */
function RegeneratingPlaceholder({ size }: { size: Size }) {
  return (
    <DesignFrame size={size}>
      <Skeleton className="absolute inset-0 rounded-none" />
      <p
        role="status"
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-4 text-center text-[13px] font-medium text-[var(--text-secondary)]"
      >
        Making a new direction…
      </p>
    </DesignFrame>
  );
}

function PreviewUnavailable({ size }: { size: Size }) {
  return (
    <DesignFrame
      size={size}
      className="flex flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <ImageOff
        aria-hidden="true"
        className="size-6 text-[var(--text-muted)]"
      />
      <p
        role="status"
        className="text-[13px] font-medium text-[var(--text-secondary)]"
      >
        Preview unavailable
      </p>
    </DesignFrame>
  );
}

type PreviewState = "loading" | "shown" | "failed";

/* An expired signed URL or a missing object fails the load; without onError
   the skeleton would stay up and keep claiming the design is on its way. */
function DesignPreview({
  url,
  alt,
  size,
}: {
  url: string;
  alt: string;
  size: Size;
}) {
  const [state, setState] = useState<PreviewState>("loading");
  if (state === "failed") return <PreviewUnavailable size={size} />;
  return (
    <DesignFrame size={size}>
      {state === "loading" ? (
        <div role="status" className="absolute inset-0">
          <Skeleton className="absolute inset-0 rounded-none" />
          <span className="sr-only">Loading the design preview…</span>
        </div>
      ) : null}
      <Image
        src={url}
        alt={alt}
        width={size.width}
        height={size.height}
        onLoad={() => setState("shown")}
        onError={() => setState("failed")}
        className="relative block h-auto w-full"
        unoptimized
      />
    </DesignFrame>
  );
}

function RegenerateError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-1.5 text-[12px] text-[var(--status-error-fg)]"
    >
      <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      {message}
    </p>
  );
}

export interface RegenerateSlotProps {
  regenerating: boolean;
  /** Another slot is regenerating. "Wait", not "working". */
  regenerateBlocked: boolean;
  regenerateError: string | null;
  onRegenerate: () => void;
}

function RegenerateButton({
  regenerating,
  regenerateBlocked,
  onRegenerate,
  index,
  className,
}: RegenerateSlotProps & { index: number; className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onRegenerate}
      loading={regenerating}
      loadingText="Regenerating…"
      disabled={regenerateBlocked}
      className={className}
      aria-label={
        regenerating ? undefined : `Regenerate direction ${index + 1}`
      }
    >
      <RefreshCw aria-hidden="true" />
      Regenerate
    </Button>
  );
}

/* A link, not a button: the route redirects to a signed URL whose disposition
   makes the browser save the file. Opened in a new tab so an expired
   session's JSON error never replaces the dialog. While the slot regenerates
   it becomes a real disabled button: an anchor styled as disabled still
   follows its href on Enter. */
function DownloadPng({
  generationId,
  index,
  disabled,
  onDownload,
}: {
  generationId: string;
  index: number;
  disabled: boolean;
  onDownload: () => void;
}) {
  const label = (
    <>
      <Download aria-hidden="true" />
      Download PNG
    </>
  );
  if (disabled) {
    return (
      <Button type="button" variant="secondary" disabled>
        {label}
        <span className="sr-only"> of direction {index + 1}</span>
      </Button>
    );
  }
  return (
    <a
      href={`/api/design/generations/${generationId}/download`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onDownload}
      className={buttonVariants({ variant: "secondary" })}
    >
      {label}
      <span className="sr-only">
        {" "}
        of direction {index + 1} (opens in a new tab)
      </span>
    </a>
  );
}

export interface DirectionCardProps extends RegenerateSlotProps {
  generation: SerializedGeneration;
  index: number;
  convertingJpg: boolean;
  onDownloadPng: () => void;
  onDownloadJpg: () => void;
  sendingToTeam: boolean;
  onSendToTeam: () => void;
}

export function DirectionCard({
  generation,
  index,
  convertingJpg,
  onDownloadPng,
  onDownloadJpg,
  sendingToTeam,
  onSendToTeam,
  ...regenerate
}: DirectionCardProps) {
  const size = sizeOf(generation);
  const direction = generation.direction;
  const title =
    direction?.title ?? generation.headline ?? `Design ${index + 1}`;
  const busy = regenerate.regenerating;

  return (
    <article
      aria-labelledby={`direction-${generation.id}`}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-surface-1"
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Eyebrow index={index} />
          <h3
            id={`direction-${generation.id}`}
            className="font-display text-[16px] leading-snug font-bold text-foreground"
          >
            {title}
          </h3>
        </div>
        <span className="shrink-0 pt-0.5 text-[12px] tabular-nums text-[var(--text-muted)]">
          {size.width} × {size.height}
        </span>
      </header>

      {busy ? (
        <RegeneratingPlaceholder size={size} />
      ) : generation.url ? (
        <DesignPreview
          url={generation.url}
          alt={`Direction ${index + 1}: ${title}`}
          size={size}
        />
      ) : (
        <PreviewUnavailable size={size} />
      )}

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* A legacy row has no rationale; it renders as it always did rather
            than with an empty "why" heading. */}
        {direction && direction.reasons.length > 0 ? (
          <section className="flex flex-col gap-1.5">
            <h4 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Why this works
            </h4>
            <ul className="flex flex-col gap-1 text-[13px] leading-snug text-[var(--text-secondary)]">
              {direction.reasons.map((reason) => (
                <li key={reason} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] size-1 shrink-0 rounded-full bg-primary"
                  />
                  {reason}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {regenerate.regenerateError ? (
          <RegenerateError message={regenerate.regenerateError} />
        ) : null}

        {/* Even rows rather than a wrapping flex row, which leaves ragged
            gaps. Sized by the card, not the viewport: "Send to design team"
            needs a full row in any card narrower than 24rem, which covers
            phones and a narrow two-up dialog alike. */}
        <div className="@container mt-auto">
          <div className="grid grid-cols-2 gap-2">
            <DownloadPng
              generationId={generation.id}
              index={index}
              disabled={busy}
              onDownload={onDownloadPng}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={onDownloadJpg}
              loading={convertingJpg}
              loadingText="Making JPG…"
              disabled={busy}
            >
              <Download aria-hidden="true" />
              Download JPG
              <span className="sr-only"> of direction {index + 1}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onSendToTeam}
              loading={sendingToTeam}
              loadingText="Sending…"
              disabled={busy}
              className="col-span-2 @sm:col-span-1"
            >
              <Send aria-hidden="true" />
              Send to design team
              <span className="sr-only"> (direction {index + 1})</span>
            </Button>
            <RegenerateButton
              index={index}
              className="col-span-2 @sm:col-span-1"
              {...regenerate}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

export interface FailedDirectionCardProps extends RegenerateSlotProps {
  index: number;
  size: Size | null;
}

/** The slot of a direction that did not render: stated, and recoverable on
 *  its own, rather than silently leaving one card. */
export function FailedDirectionCard({
  index,
  size,
  ...regenerate
}: FailedDirectionCardProps) {
  const box = size ?? FALLBACK_SIZE;
  return (
    <article
      aria-label={`Direction ${index + 1} did not render`}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-surface-1"
    >
      <header className="px-4 pt-3.5 pb-3">
        <Eyebrow index={index} />
        <h3 className="font-display text-[16px] leading-snug font-bold text-foreground">
          This direction didn't render
        </h3>
      </header>
      {regenerate.regenerating ? (
        <RegeneratingPlaceholder size={box} />
      ) : (
        <DesignFrame
          size={box}
          className="flex flex-col items-center justify-center gap-2 px-6 text-center"
        >
          <ImageOff
            aria-hidden="true"
            className="size-6 text-[var(--text-muted)]"
          />
          <p className="max-w-[260px] text-[13px] leading-snug text-[var(--text-secondary)]">
            The other direction is ready to use. Regenerate this one for a fresh
            take.
          </p>
        </DesignFrame>
      )}
      <div className="flex flex-col gap-3 p-4">
        {regenerate.regenerateError ? (
          <RegenerateError message={regenerate.regenerateError} />
        ) : null}
        <div className="flex justify-end">
          <RegenerateButton index={index} {...regenerate} />
        </div>
      </div>
    </article>
  );
}
