"use client";

import {
  Download,
  GalleryHorizontal,
  Pencil,
  Presentation,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
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
  kindNoun,
  roleLabel,
  slideCount,
} from "./set-model";
import { SetStage } from "./set-stage";
import { regenKey } from "./use-frame-set";

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
}

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

  const status =
    state === "rendering" ? "rendering" : state === "ready" ? null : "failed";

  return (
    <section
      aria-roledescription="carousel"
      aria-label={`${kindNoun(set.kind)}, ${slideCount(count)}`}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <KindPill set={set} />
        <SetDownloads set={set} blocked={actingOn.size > 0} />
      </div>

      <SetStage
        set={set}
        size={size}
        selected={index}
        onSelect={select}
        isRegenerating={regenerating}
        frameLabel={frameLabel}
        onRetry={(target) => void regenerate(target)}
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
            <p
              role="status"
              aria-atomic="true"
              className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]"
            >
              {position} · {role}
              {pending ? (
                <span className="sr-only">, regenerating</span>
              ) : status ? (
                <span className="sr-only">
                  , {status === "failed" ? "didn't render" : "still rendering"}
                </span>
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

        {frameErrors[slot.index] ? (
          <FrameError message={frameErrors[slot.index] ?? ""} />
        ) : null}

        {state === "missing" ? (
          <p className="text-[13px] leading-snug text-[var(--text-secondary)]">
            The job never got to this frame. Make the {kindNoun(set.kind)} again
            to fill it.
          </p>
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
              disabled={pending || state === "rendering"}
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
                disabled={state === "rendering"}
                aria-label={
                  pending ? undefined : `Regenerate frame ${slot.index + 1}`
                }
              >
                <RefreshCw aria-hidden="true" />
                Regenerate
              </Button>
            )}
            {state === "ready" && !pending && slot.generation ? (
              /* A link, as on a direction card: the route redirects to a
                 signed URL whose disposition saves the file. */
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
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
