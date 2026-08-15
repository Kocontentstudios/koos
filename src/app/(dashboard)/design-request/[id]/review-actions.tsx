"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  AnnotationCanvas,
  type AnnotationCanvasMark,
} from "@/components/design/annotation-canvas";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AnnotationShape } from "@/lib/db/queries";
import { canRequestRevision, MAX_DELIVERY_ROUNDS } from "@/lib/design/ticket";
import { cn } from "@/lib/utils";

export type ReviewDeliverable = { id: string; fileName: string; url: string };

type ReviseAnnotation = {
  deliverableId: string;
  shapes: AnnotationShape[];
  note?: string;
};

type Mode = "idle" | "revising" | "confirming";

export function ReviewActions({
  ticketId,
  version,
  deliverables = [],
}: {
  ticketId: string;
  /** Delivery round under review. Required — it decides whether another
   * revision is still available, so defaulting it would silently mislead. */
  version: number;
  deliverables?: ReviewDeliverable[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"approve" | "revise" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markupId, setMarkupId] = useState<string | null>(null);
  const [marksByDeliverable, setMarksByDeliverable] = useState<
    Record<string, AnnotationCanvasMark[]>
  >({});

  function collectAnnotations(): ReviseAnnotation[] {
    const annotations: ReviseAnnotation[] = [];
    for (const [deliverableId, marks] of Object.entries(marksByDeliverable)) {
      for (const mark of marks) {
        annotations.push({
          deliverableId,
          shapes: mark.shapes,
          note: mark.note,
        });
      }
    }
    return annotations;
  }

  const annotations = collectAnnotations();
  // The server rejects a revision with neither a note nor markup, so mirror
  // that rule here rather than letting the client discover it via a 400.
  const canSubmitRevision = note.trim().length > 0 || annotations.length > 0;

  async function submit(action: "approve" | "revise") {
    if (pending) return;
    setPending(action);
    setError(null);
    try {
      const body =
        action === "revise"
          ? { action, note: note.trim() || undefined, annotations }
          : { action };
      const res = await fetch(`/api/design-tickets/${ticketId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        const msg = data?.error ?? "Something went wrong. Please try again.";
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success(
        action === "approve"
          ? "Design approved — this request is now closed."
          : "Revision requested — the design team has been notified.",
      );
      router.refresh();
    } catch {
      const msg = "Network error. Please try again.";
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(null);
    }
  }

  const versionLabel = `version ${version}`;
  const revisionsLeft = canRequestRevision(version);

  return (
    <section className="space-y-4 rounded-xl border border-[var(--border-accent)] bg-surface-1 p-5">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-foreground">
            How does this look?
          </h2>
          {version && (
            <span className="text-[12px] text-[var(--text-muted)]">
              Round {version} of {MAX_DELIVERY_ROUNDS}
            </span>
          )}
        </div>
        <p className="text-[13px] text-[var(--text-secondary)]">
          {mode === "confirming"
            ? `Marking ${versionLabel} as satisfied closes this request and unlocks the download.`
            : revisionsLeft
              ? `Review ${versionLabel} and let the design team know if it's good to go.`
              : `This was the final revision round. Mark it satisfied to close the request and unlock the download — or reach out to the design team if it still isn't right.`}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-[var(--status-error-fg)]">
          {error}
        </p>
      )}

      {mode === "idle" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {revisionsLeft && (
            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                setError(null);
                setMode("revising");
              }}
            >
              Request Revision
            </Button>
          )}
          <Button
            variant="default"
            size="lg"
            onClick={() => {
              setError(null);
              setMode("confirming");
            }}
          >
            Satisfied
          </Button>
        </div>
      )}

      {mode === "confirming" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            size="lg"
            disabled={pending !== null}
            onClick={() => setMode("idle")}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            size="lg"
            loading={pending === "approve"}
            loadingText="Approving…"
            disabled={pending !== null}
            onClick={() => submit("approve")}
          >
            Yes, I'm satisfied
          </Button>
        </div>
      )}

      {mode === "revising" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label
              htmlFor="revision-note"
              className="text-[13px] font-medium text-foreground"
            >
              What would you like changed?
            </label>
            <Textarea
              id="revision-note"
              // biome-ignore lint/a11y/noAutofocus: the field is revealed by an explicit user action and is the sole purpose of this panel
              autoFocus
              value={note}
              disabled={pending !== null}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe the changes you'd like the design team to make."
              className="min-h-[120px]"
            />
          </div>

          {deliverables.length > 0 && (
            <div className="space-y-3">
              <p className="text-[13px] text-[var(--text-secondary)]">
                Optionally mark up the design to point at exactly what to
                change.
              </p>
              <div className="flex flex-wrap gap-2">
                {deliverables.map((d) => {
                  const markCount = marksByDeliverable[d.id]?.length ?? 0;
                  const active = markupId === d.id;
                  return (
                    <Button
                      key={d.id}
                      type="button"
                      variant={active ? "secondary" : "outline"}
                      size="sm"
                      aria-pressed={active}
                      disabled={pending !== null}
                      onClick={() =>
                        setMarkupId((current) =>
                          current === d.id ? null : d.id,
                        )
                      }
                    >
                      Mark up {d.fileName}
                      {markCount > 0 ? ` (${markCount})` : ""}
                    </Button>
                  );
                })}
              </div>

              {/* Every markable deliverable stays mounted (just hidden) so
               * switching between them doesn't wipe out marks already drawn. */}
              {deliverables.map((d) => (
                <div
                  key={d.id}
                  className={cn(markupId === d.id ? "block" : "hidden")}
                >
                  <AnnotationCanvas
                    imageUrl={d.url}
                    onChange={(marks) =>
                      setMarksByDeliverable((prev) => ({
                        ...prev,
                        [d.id]: marks,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              size="lg"
              disabled={pending !== null}
              onClick={() => {
                setMode("idle");
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="lg"
              loading={pending === "revise"}
              loadingText="Sending…"
              disabled={pending !== null || !canSubmitRevision}
              onClick={() => submit("revise")}
            >
              Submit Request
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
