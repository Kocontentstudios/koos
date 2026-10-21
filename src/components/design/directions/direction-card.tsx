"use client";

import { Download, ImageOff, RefreshCw, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { captureEvent } from "@/lib/analytics/posthog-client";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { cn } from "@/lib/utils";

const FALLBACK_SIZE = { width: 1080, height: 1350 };

function sizeOf(generation: SerializedGeneration | null) {
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

/** Replaces the design while a new one is made for this slot, so the old
 *  design is never mistaken for the result. */
function RegeneratingPlaceholder({
  size,
}: {
  size: { width: number; height: number };
}) {
  return (
    <div
      className="relative max-h-[44vh] w-full"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      <Skeleton className="absolute inset-0 rounded-none" />
      <p
        role="status"
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-4 text-center text-[13px] font-medium text-[var(--text-secondary)]"
      >
        Making a new direction…
      </p>
    </div>
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
}: RegenerateSlotProps & { index: number }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onRegenerate}
      loading={regenerating}
      loadingText="Regenerating…"
      disabled={regenerateBlocked}
      className="w-full lg:w-auto"
      aria-label={
        regenerating ? undefined : `Regenerate direction ${index + 1}`
      }
    >
      <RefreshCw aria-hidden="true" />
      Regenerate
    </Button>
  );
}

export interface DirectionCardProps extends RegenerateSlotProps {
  generation: SerializedGeneration;
  index: number;
  convertingJpg: boolean;
  onDownloadJpg: () => void;
}

export function DirectionCard({
  generation,
  index,
  convertingJpg,
  onDownloadJpg,
  ...regenerate
}: DirectionCardProps) {
  const [loaded, setLoaded] = useState(false);
  const size = sizeOf(generation);
  const direction = generation.direction;
  const title =
    direction?.title ?? generation.headline ?? `Design ${index + 1}`;

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

      {regenerate.regenerating ? (
        <RegeneratingPlaceholder size={size} />
      ) : generation.url ? (
        /* Height-capped so a portrait design never pushes its own download
           buttons below the fold on a laptop screen. */
        <div
          className="relative max-h-[44vh] w-full bg-[var(--surface-container-lowest)]"
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
        >
          {loaded ? null : (
            <Skeleton className="absolute inset-0 rounded-none" />
          )}
          <Image
            src={generation.url}
            alt={`Direction ${index + 1}: ${title}`}
            width={size.width}
            height={size.height}
            onLoad={() => setLoaded(true)}
            className="relative size-full object-contain"
            unoptimized
          />
        </div>
      ) : (
        <div
          className="flex max-h-[44vh] w-full items-center justify-center bg-[var(--surface-container-lowest)] text-[13px] text-[var(--text-muted)]"
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
        >
          Preview unavailable
        </div>
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

        {/* Two downloads side by side and Regenerate on its own row on a
            narrow card, where three buttons in one row wrap unevenly. */}
        <div className="mt-auto grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:items-center">
          {/* A link, not a button: the route redirects to a signed URL whose
              disposition makes the browser save the file. Opened in a new tab
              so an expired session's JSON error never replaces the dialog. */}
          <a
            href={`/api/design/generations/${generation.id}/download`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => captureEvent("design_downloaded", { format: "png" })}
            aria-disabled={regenerate.regenerating || undefined}
            className={cn(
              buttonVariants({ variant: "secondary" }),
              regenerate.regenerating && "pointer-events-none opacity-50",
            )}
          >
            <Download aria-hidden="true" />
            Download PNG
            <span className="sr-only">
              {" "}
              of direction {index + 1} (opens in a new tab)
            </span>
          </a>
          <Button
            type="button"
            variant="secondary"
            onClick={onDownloadJpg}
            loading={convertingJpg}
            loadingText="Making JPG…"
            disabled={regenerate.regenerating}
          >
            <Download aria-hidden="true" />
            Download JPG
            <span className="sr-only"> of direction {index + 1}</span>
          </Button>
          <span className="col-span-2 lg:ml-auto">
            <RegenerateButton index={index} {...regenerate} />
          </span>
        </div>
      </div>
    </article>
  );
}

export interface FailedDirectionCardProps extends RegenerateSlotProps {
  index: number;
  size: { width: number; height: number } | null;
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
        <div
          className="flex max-h-[44vh] w-full flex-col items-center justify-center gap-2 bg-[var(--surface-container-lowest)] px-6 text-center"
          style={{ aspectRatio: `${box.width} / ${box.height}` }}
        >
          <ImageOff
            aria-hidden="true"
            className="size-6 text-[var(--text-muted)]"
          />
          <p className="max-w-[260px] text-[13px] leading-snug text-[var(--text-secondary)]">
            The other direction is ready to use. Regenerate this one for a fresh
            take.
          </p>
        </div>
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
