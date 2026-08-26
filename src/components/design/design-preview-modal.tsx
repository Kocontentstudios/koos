"use client";

import { Download, Send, Sparkles } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { cn } from "@/lib/utils";

export interface DesignPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  generations: SerializedGeneration[];
  pending: boolean;
  progressLabel: string | null;
  error: string | null;
  onRegenerate?: () => void;
  /** Context carried into a design ticket when the user sends to the team. */
  ticketContext?: {
    briefId?: string | null;
    calendarItemId?: string | null;
    designType?: string | null;
    dimensions?: string | null;
    brief?: string | null;
  };
}

const RENDERER_LABEL: Record<SerializedGeneration["renderer"], string> = {
  composite: "Exact brand colours & logo",
  native: "AI-rendered layout",
};

export function DesignPreviewModal({
  open,
  onOpenChange,
  brandId,
  generations,
  pending,
  progressLabel,
  error,
  onRegenerate,
  ticketContext,
}: DesignPreviewModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const selected =
    generations.find((g) => g.id === selectedId) ?? generations[0] ?? null;

  async function handleSendToTeam() {
    if (!selected) return;
    setSending(true);
    try {
      const res = await fetch("/api/design-tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brandId,
          briefId: ticketContext?.briefId ?? undefined,
          calendarItemId: ticketContext?.calendarItemId ?? undefined,
          designType:
            ticketContext?.designType ?? selected.designType ?? "Social post",
          dimensions: ticketContext?.dimensions ?? undefined,
          brief:
            ticketContext?.brief ??
            selected.headline ??
            "Polish the attached AI-generated design.",
          referenceImageUrl: selected.url,
          generationId: selected.id,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not send to the design team.");
      }
      const { ticket } = (await res.json()) as {
        ticket?: { ticketNumber?: number };
      };
      toast.success(
        ticket?.ticketNumber
          ? `Sent to the design team as DT-${ticket.ticketNumber}`
          : "Sent to the design team",
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not send to the design team.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Generated design</DialogTitle>
          <DialogDescription>
            Built from your brand profile and brief. Pick a version to download
            or hand to the design team.
          </DialogDescription>
        </DialogHeader>

        {pending ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Spinner />
            <p className="text-[14px] text-[var(--text-muted)]">
              {progressLabel ?? "Generating…"}
            </p>
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <p className="text-[14px] text-[var(--status-error-fg)]">{error}</p>
          </div>
        ) : generations.length === 0 ? (
          <p className="py-10 text-center text-[14px] text-[var(--text-muted)]">
            No designs yet.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {generations.map((generation) => {
              const isSelected = selected?.id === generation.id;
              return (
                <button
                  key={generation.id}
                  type="button"
                  onClick={() => setSelectedId(generation.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border p-2 text-left transition-colors",
                    isSelected
                      ? "border-[var(--border-accent)] ring-[3px] ring-[var(--accent-glow)]"
                      : "border-[var(--border)] hover:border-[var(--border-accent)]",
                  )}
                >
                  {generation.url ? (
                    <Image
                      src={generation.url}
                      alt={generation.headline ?? "Generated design"}
                      width={generation.width ?? 1080}
                      height={generation.height ?? 1080}
                      className="w-full rounded-lg"
                      unoptimized
                    />
                  ) : null}
                  <span className="px-1 pb-1 text-[12px] text-[var(--text-muted)]">
                    {RENDERER_LABEL[generation.renderer]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter>
          {onRegenerate ? (
            <Button
              variant="secondary"
              onClick={onRegenerate}
              loading={pending}
              loadingText="Regenerating…"
            >
              <Sparkles className="size-4" />
              Regenerate
            </Button>
          ) : null}
          {selected?.url ? (
            <a
              href={selected.url}
              download={`design-${selected.id.slice(0, 8)}.png`}
            >
              <Button variant="secondary">
                <Download className="size-4" />
                Download
              </Button>
            </a>
          ) : null}
          <Button
            onClick={handleSendToTeam}
            loading={sending}
            loadingText="Sending…"
            disabled={!selected || pending}
          >
            <Send className="size-4" />
            Send to design team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
