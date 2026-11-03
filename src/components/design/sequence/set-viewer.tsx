"use client";

import {
  Download,
  GalleryHorizontal,
  Hourglass,
  Pencil,
  Presentation,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { FrameEdits } from "@/lib/design/sequence/contract";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { FrameEditor } from "./frame-editor";
import { FrameRail, tabIdOf } from "./frame-rail";
import { SetDownloads } from "./set-downloads";
import {
  type DesignSet,
  type FrameSlot,
  frameSize,
  frameState,
  isBuilding,
  kindNoun,
  leftOutNotice,
  roleLabel,
  slideCount,
} from "./set-model";
import { SetStage } from "./set-stage";
import { FRAME_STILL_RUNNING, regenKey } from "./use-frame-set";

export interface SetViewerProps {
  set: DesignSet;
  /** `regen:${generationId}` for every frame regenerating. */
  actingOn: ReadonlySet<string>;
  /** Keyed by frame index. */
  frameErrors: Readonly<Record<number, string>>;
  onRegenerateFrame: (
    generationId: string,
    edits?: FrameEdits,
  ) => Promise<SerializedGeneration | null>;
  /** Frame indexes whose regenerate outlived the poll and may still deliver. */
  stillRunning?: ReadonlySet<number>;
  onKeepWaiting?: (index: number) => void;
  /** FEATURE_MULTI_FRAME, from the server. Off, the set's routes (ZIP, PDF,
   *  regenerate) answer 404, so a set made while it was on is shown with
   *  per-frame downloads only: an action that can only fail is not
   *  offered. */
  setActions?: boolean;
}

const NONE_WAITING: ReadonlySet<number> = new Set();

/* Said of the set as a whole while its job is still delivering frames, so
   the skeletons on the stage and rail are never the only sign of it. */
function buildingLine(set: DesignSet): string | null {
  if (!isBuilding(set)) return null;
  const count = set.frames.length;
  const ready = set.frames.filter((s) => frameState(s) === "ready").length;
  const failed = set.frames.filter((s) => frameState(s) === "failed").length;
  const next = Math.min(ready + failed + 1, count);
  return `Frame ${next} of ${count}… ${ready} of ${count} ready. The rest appear here as they land.`;
}

function BuildingStatus({ line }: { line: string | null }) {
  if (!line) return null;
  return (
    <p
      data-building-status
      className="flex items-center gap-2 rounded-lg bg-[var(--status-progress-bg)] px-3 py-2 text-[13px] text-[var(--status-progress-fg)]"
    >
      <Spinner className="size-3.5 shrink-0" />
      {line}
    </p>
  );
}

/**
 * The viewer's one live region. Each part is its own node, so only the part
 * that changed is read out: moving to a frame says where you are, a frame
 * landing says how far the set has got, and neither repeats the other.
 */
function ViewerAnnouncer({
  position,
  building,
  waiting,
}: {
  position: string;
  building: string | null;
  waiting: string | null;
}) {
  return (
    <div role="status" data-viewer-status className="sr-only">
      <span data-announce="position">{position}</span>
      {building ? <span data-announce="building"> {building}</span> : null}
      {waiting ? <span data-announce="waiting"> {waiting}</span> : null}
    </div>
  );
}

function FrameWaiting({
  message,
  onKeepWaiting,
}: {
  message: string;
  onKeepWaiting?: () => void;
}) {
  return (
    <div
      data-frame-waiting
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--status-progress-bg)] px-3 py-2"
    >
      <p className="flex items-start gap-1.5 text-[12px] text-[var(--status-progress-fg)]">
        <Hourglass aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        {message}
      </p>
      {onKeepWaiting ? (
        <Button type="button" size="sm" onClick={onKeepWaiting}>
          Keep waiting
        </Button>
      ) : null}
    </div>
  );
}

/* "carousel" is the ARIA pattern's own word; a deck read out as a carousel
   would misname what the user is holding. */
const ROLE_DESCRIPTION: Record<DesignSet["kind"], string> = {
  carousel: "carousel",
  presentation: "slide deck",
};

function KindPill({ set }: { set: DesignSet }) {
  const Icon = set.kind === "carousel" ? GalleryHorizontal : Presentation;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--status-progress-bg)] px-2.5 py-1 text-[12px] font-medium text-[var(--status-progress-fg)]">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="capitalize">{kindNoun(set.kind)}</span>
      <span aria-hidden="true">·</span>
      {slideCount(set.frames.length)}
    </span>
  );
}

/* Said once, above the stage: the owner counted the slides they asked
   for, and a shorter set with no word of why reads as a lost slide. */
function LeftOutNotice({ set }: { set: DesignSet }) {
  const notice = leftOutNotice(set);
  if (!notice) return null;
  return (
    <div
      data-left-out
      className="flex gap-2 rounded-lg bg-[var(--status-pending-bg)] px-3 py-2 text-[12px] leading-snug text-[var(--status-pending-fg)]"
    >
      <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium">{notice.summary}</p>
        <ul className="flex flex-col gap-0.5">
          {notice.slides.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FrameDownload({ slot }: { slot: FrameSlot }) {
  if (frameState(slot) !== "ready" || !slot.generation) return null;
  /* A link, as on a direction card: the route redirects to a signed URL
     whose disposition saves the file. */
  return (
    <a
      href={`/api/design/generations/${slot.generation.id}/download`}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonVariants({ variant: "ghost" })}
    >
      <Download aria-hidden="true" />
      Download this frame
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/* Shown in place of the set's actions while they are switched off: the
   owner keeps every frame they made, one download at a time. */
function ViewOnlyActions({
  slot,
  kind,
}: {
  slot: FrameSlot;
  kind: DesignSet["kind"];
}) {
  return (
    <div className="flex flex-col gap-2" data-view-only>
      <p className="text-[13px] leading-snug text-[var(--text-secondary)]">
        Editing this {kindNoun(kind)} and downloading it in one file are
        switched off for now. You can still download each frame.
      </p>
      <div className="flex flex-wrap gap-2">
        <FrameDownload slot={slot} />
      </div>
    </div>
  );
}

function FrameError({ message }: { message: string }) {
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

/**
 * A carousel or presentation as the one thing it is: the selected frame
 * large, in the box it will be posted in, every frame on a rail under it,
 * and the selected frame's own actions under that. Editing a frame is two
 * clicks: its thumbnail, then "Edit & regenerate".
 */
export function SetViewer({
  set,
  actingOn,
  frameErrors,
  onRegenerateFrame,
  stillRunning = NONE_WAITING,
  onKeepWaiting,
  setActions = true,
}: SetViewerProps) {
  const baseId = useId();
  const panelId = `${baseId}-stage`;
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  const count = set.frames.length;
  const index = Math.min(selected, count - 1);
  const slot = set.frames[index];
  const size = frameSize(set);
  const regenerating = (s: FrameSlot) =>
    s.generation ? actingOn.has(regenKey(s.generation.id)) : false;

  /* The editor's buttons go when it closes; focus goes back to the button
     that opened it rather than falling to the dialog. */
  useEffect(() => {
    if (editing === null && restoreFocus.current) {
      restoreFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  if (!slot) return null;

  const role = roleLabel(set.kind, slot.role);
  const state = frameState(slot);
  const pending = regenerating(slot);
  const title =
    slot.title || slot.generation?.headline || `${role} ${slot.index + 1}`;
  const position = `Frame ${slot.index + 1} of ${count}`;

  const frameLabel = (s: FrameSlot) => {
    const name = `Frame ${s.index + 1} of ${count}, ${roleLabel(set.kind, s.role)}`;
    const named = s.title ? `${name}: ${s.title}` : name;
    if (regenerating(s)) return `${named} (regenerating)`;
    const st = frameState(s);
    if (st === "failed" || st === "missing") return `${named} (didn't render)`;
    if (st === "rendering") return `${named} (rendering)`;
    return named;
  };

  function select(next: number) {
    setSelected(next);
    if (editing !== null && editing !== next) setEditing(null);
  }

  function closeEditor() {
    restoreFocus.current = true;
    setEditing(null);
  }

  async function regenerate(target: FrameSlot, edits?: FrameEdits) {
    const id = target.generation?.id;
    if (!id) return;
    const row = await onRegenerateFrame(id, edits);
    if (row && edits) closeEditor();
  }

  const waiting = stillRunning.has(slot.index);
  /* A frame whose job may still deliver is not offered a second, billed
     regenerate: "Keep waiting" follows the one already running. */
  const held = pending || waiting || state === "rendering";
  const statusNote = pending
    ? "regenerating"
    : state === "rendering"
      ? "still rendering"
      : state === "ready"
        ? null
        : "didn't render";
  const building = buildingLine(set);
  const waitingMessage = waiting
    ? (frameErrors[slot.index] ?? FRAME_STILL_RUNNING)
    : null;

  return (
    <section
      aria-roledescription={ROLE_DESCRIPTION[set.kind]}
      aria-label={`${kindNoun(set.kind)}, ${slideCount(count)}`}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <KindPill set={set} />
        {setActions ? (
          <SetDownloads set={set} blocked={actingOn.size > 0} />
        ) : null}
      </div>

      <ViewerAnnouncer
        position={`${position} · ${role}${statusNote ? `, ${statusNote}` : ""}`}
        building={building}
        waiting={waitingMessage}
      />

      <LeftOutNotice set={set} />

      <BuildingStatus line={building} />

      <SetStage
        set={set}
        size={size}
        selected={index}
        onSelect={select}
        isRegenerating={regenerating}
        frameLabel={frameLabel}
        onRetry={setActions ? (target) => void regenerate(target) : undefined}
        panelId={panelId}
        tabId={tabIdOf(baseId, index)}
      />

      <FrameRail
        set={set}
        size={size}
        selected={index}
        onSelect={select}
        isRegenerating={regenerating}
        frameLabel={frameLabel}
        baseId={baseId}
        panelId={panelId}
      />

      <div
        className="flex flex-col gap-3 rounded-xl border bg-surface-1 p-4"
        data-frame-panel={slot.index}
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              {position} · {role}
              {statusNote ? (
                <span className="sr-only">{`, ${statusNote}`}</span>
              ) : null}
            </p>
            <h3 className="font-display text-[16px] leading-snug font-bold text-foreground">
              {title}
            </h3>
          </div>
          <span className="shrink-0 pt-0.5 text-[12px] tabular-nums text-[var(--text-muted)]">
            {size.width} × {size.height}
          </span>
        </header>

        {waitingMessage ? (
          <FrameWaiting
            message={waitingMessage}
            onKeepWaiting={
              onKeepWaiting ? () => onKeepWaiting(slot.index) : undefined
            }
          />
        ) : frameErrors[slot.index] ? (
          <FrameError message={frameErrors[slot.index] ?? ""} />
        ) : null}

        {state === "missing" ? (
          <p className="text-[13px] leading-snug text-[var(--text-secondary)]">
            The job never got to this frame. Make the {kindNoun(set.kind)} again
            to fill it.
          </p>
        ) : !setActions ? (
          <ViewOnlyActions slot={slot} kind={set.kind} />
        ) : editing === slot.index ? (
          <FrameEditor
            key={slot.generation?.id}
            slot={slot}
            frameName={`frame ${slot.index + 1}`}
            pending={pending}
            onSubmit={(edits) => void regenerate(slot, edits)}
            onCancel={closeEditor}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              ref={editButton}
              type="button"
              variant="secondary"
              onClick={() => setEditing(slot.index)}
              disabled={held}
              aria-label={`Edit & regenerate frame ${slot.index + 1}`}
            >
              <Pencil aria-hidden="true" />
              Edit &amp; regenerate
            </Button>
            {/* A failed frame's retry sits on the frame itself (SetStage). */}
            {state === "failed" ? null : (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void regenerate(slot)}
                loading={pending}
                loadingText="Regenerating…"
                disabled={state === "rendering" || waiting}
                aria-label={
                  pending ? undefined : `Regenerate frame ${slot.index + 1}`
                }
              >
                <RefreshCw aria-hidden="true" />
                Regenerate
              </Button>
            )}
            {pending ? null : <FrameDownload slot={slot} />}
          </div>
        )}
      </div>
    </section>
  );
}
