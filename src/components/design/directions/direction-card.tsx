"use client";

import {
  Check,
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

/** Focusable by script only: a regenerate that replaces the card moves focus
 *  here so the keyboard user lands on the new direction. */
const SLOT_CARD =
  "flex min-w-0 flex-col overflow-hidden rounded-xl border bg-surface-1 outline-none focus-visible:focus-outline";

const CARD_TITLE =
  "font-display text-[16px] leading-snug font-bold text-foreground";

/** While a slot regenerates, the old title would label a design that is no
 *  longer there; the heading says what is happening instead. */
function CardHeading({
  id,
  index,
  title,
  regenerating,
}: {
  id?: string;
  index: number;
  title: string;
  regenerating: boolean;
}) {
  if (!regenerating) {
    return (
      <h3 id={id} className={CARD_TITLE}>
        {title}
      </h3>
    );
  }
  return (
    <>
      <h3 id={id} className="sr-only">
        Regenerating direction {index + 1}
      </h3>
      <Skeleton className="mt-1 h-5 w-44 max-w-full" />
    </>
  );
}

function ReasonsPlaceholder() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-4/5" />
    </div>
  );
}

/** The design's own box at its own aspect ratio, full card width, so every
 *  state of a slot (loading, shown, unavailable, regenerating) is the same
 *  size and the cards never jump. */
function DesignFrame({
  size,
  children,
}: {
  size: Size;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative w-full bg-[var(--surface-container-lowest)]"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      {children}
    </div>
  );
}

/** A slot with no design to show. --surface-container-lowest is the card's
 *  own white in light mode, so the empty slot gets a recessed fill and a
 *  dashed outline, or it has no visible edge at all. */
function EmptyFrame({
  size,
  children,
}: {
  size: Size;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative flex w-full flex-col items-center justify-center gap-2 bg-[var(--surface-container-low)] px-6 text-center"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      {/* Inline, not a border utility: globals.css sets `* { border-color }`
          unlayered, which beats every border-* utility class. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-3 rounded-lg border-2 border-dashed"
        style={{ borderColor: "var(--border-control)" }}
      />
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
    <EmptyFrame size={size}>
      <ImageOff
        aria-hidden="true"
        className="relative size-6 text-[var(--text-muted)]"
      />
      <p
        role="status"
        className="relative text-[13px] font-medium text-[var(--text-secondary)]"
      >
        Preview unavailable
      </p>
    </EmptyFrame>
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

function CardError({ message }: { message: string }) {
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

/** Said on the card it is about, not in a toast: a toast sits over the
 *  dialog's own footer, and on a phone hid "Stay here" for its lifetime. The
 *  region is always mounted (sr-only while empty, so it takes no gap) so a
 *  screen reader announces the message the moment it lands. */
function SentNotice({ message }: { message: string | null }) {
  return (
    <p
      role="status"
      data-slot="sent-notice"
      className="flex items-start gap-1.5 text-[12px] font-medium text-[var(--status-ready-fg)] empty:sr-only"
    >
      {message ? (
        <>
          <Check aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {message}
        </>
      ) : null}
    </p>
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
  /** Set once this design has a ticket; sending it again would open a
   *  duplicate. */
  sentMessage: string | null;
  /** A download or send that failed on this card. */
  actionErrors: string[];
}

export function DirectionCard({
  generation,
  index,
  convertingJpg,
  onDownloadPng,
  onDownloadJpg,
  sendingToTeam,
  onSendToTeam,
  sentMessage,
  actionErrors,
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
      data-direction-slot={index}
      tabIndex={-1}
      className={SLOT_CARD}
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Eyebrow index={index} />
          <CardHeading
            id={`direction-${generation.id}`}
            index={index}
            title={title}
            regenerating={busy}
          />
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
        {busy ? (
          <ReasonsPlaceholder />
        ) : direction && direction.reasons.length > 0 ? (
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
          <CardError message={regenerate.regenerateError} />
        ) : null}
        {actionErrors.map((message) => (
          <CardError key={message} message={message} />
        ))}
        <SentNotice message={sentMessage} />

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
              disabled={busy || sentMessage !== null}
              focusableWhenDisabled={sentMessage !== null}
              className="col-span-2 @sm:col-span-1"
            >
              {sentMessage ? (
                <Check aria-hidden="true" />
              ) : (
                <Send aria-hidden="true" />
              )}
              {sentMessage ? "Sent to design team" : "Send to design team"}
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
  /** Another slot holds a design, so this card can point the user to it. */
  otherReady: boolean;
}

/** The slot of a direction that did not render: stated, and recoverable on
 *  its own, rather than silently leaving one card. */
export function FailedDirectionCard({
  index,
  size,
  otherReady,
  ...regenerate
}: FailedDirectionCardProps) {
  const box = size ?? FALLBACK_SIZE;
  return (
    <article
      aria-label={
        regenerate.regenerating
          ? `Regenerating direction ${index + 1}`
          : `Direction ${index + 1} did not render`
      }
      data-direction-slot={index}
      tabIndex={-1}
      className={SLOT_CARD}
    >
      <header className="flex flex-col gap-0.5 px-4 pt-3.5 pb-3">
        <Eyebrow index={index} />
        <CardHeading
          index={index}
          title="This direction didn't render"
          regenerating={regenerate.regenerating}
        />
      </header>
      {regenerate.regenerating ? (
        <RegeneratingPlaceholder size={box} />
      ) : (
        <EmptyFrame size={box}>
          <ImageOff
            aria-hidden="true"
            className="relative size-6 text-[var(--text-muted)]"
          />
          <p className="relative max-w-[260px] text-[13px] leading-snug text-[var(--text-secondary)]">
            {otherReady
              ? "The other direction is ready to use. Regenerate this one for a fresh take."
              : "Regenerate it to try again."}
          </p>
        </EmptyFrame>
      )}
      {/* Same body as a ready card's regenerate, so a failed slot coming back
          reads as the same wait rather than an empty panel. */}
      <div className="flex flex-1 flex-col gap-4 p-4">
        {regenerate.regenerating ? <ReasonsPlaceholder /> : null}
        {regenerate.regenerateError ? (
          <CardError message={regenerate.regenerateError} />
        ) : null}
        <div className="mt-auto flex justify-end">
          <RegenerateButton index={index} {...regenerate} />
        </div>
      </div>
    </article>
  );
}
