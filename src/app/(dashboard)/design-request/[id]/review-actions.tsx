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
import { cn } from "@/lib/utils";

export type ReviewDeliverable = { id: string; fileName: string; url: string };

type ReviseAnnotation = {
  deliverableId: string;
  shapes: AnnotationShape[];
  note?: string;
};

export function ReviewActions({
  ticketId,
  deliverables = [],
}: {
  ticketId: string;
  deliverables?: ReviewDeliverable[];
}) {
  const router = useRouter();
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

  async function submit(action: "approve" | "revise") {
    if (pending) return;
    setPending(action);
    setError(null);
    try {
      const body =
        action === "revise"
          ? {
              action,
              note: note.trim() || undefined,
              annotations: collectAnnotations(),
            }
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
        action === "approve" ? "Design approved" : "Revision requested",
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

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] bg-surface-1 p-5">
      <h2 className="text-[15px] font-semibold text-foreground">
        Review this design
      </h2>
      <p className="text-[13px] text-[var(--text-secondary)]">
        Approve to mark it delivered, or request a revision with a note for the
        designer.
      </p>

      {deliverables.length > 0 && (
        <div className="space-y-3">
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
                    setMarkupId((current) => (current === d.id ? null : d.id))
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
                  setMarksByDeliverable((prev) => ({ ...prev, [d.id]: marks }))
                }
              />
            </div>
          ))}
        </div>
      )}

      <Textarea
        aria-label="Revision note"
        value={note}
        disabled={pending !== null}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What needs changing? (optional, for revisions)"
        className="min-h-[80px]"
      />
      {error && (
        <p role="alert" className="text-[13px] text-[var(--status-error-fg)]">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          size="lg"
          loading={pending === "revise"}
          loadingText="Sending…"
          disabled={pending !== null}
          onClick={() => submit("revise")}
        >
          Request Revision
        </Button>
        <Button
          variant="default"
          size="lg"
          loading={pending === "approve"}
          loadingText="Approving…"
          disabled={pending !== null}
          onClick={() => submit("approve")}
        >
          Approve
        </Button>
      </div>
    </section>
  );
}
