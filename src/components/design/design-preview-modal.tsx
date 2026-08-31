"use client";

import { Download, Send, Sparkles } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
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
  /** Absent when viewing an existing design: there is nothing to regenerate. */
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

/** Older native rows stored no size, so this stays honest rather than guessing. */
function resolutionLabel(generation: SerializedGeneration): string | null {
  return generation.width && generation.height
    ? `${generation.width} × ${generation.height}`
    : null;
}

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
  const resolution = selected ? resolutionLabel(selected) : null;

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
      {/* Bottom sheet on phones: a design fills a small viewport, and covering
          the backdrop would remove tap-outside-to-dismiss. */}
      <DialogContent className="grid-rows-[minmax(0,1fr)] gap-0 sm:max-h-[90vh] sm:max-w-3xl max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[90vh] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:[&_[data-slot=dialog-close]]:size-11 [@media(hover:none)]:[&_[data-slot=dialog-close]]:size-11">
        {/* Scroll the contents, not the popup: the close button is positioned
            against the popup, so scrolling that carries the X off-screen. */}
        <div className="flex flex-col overflow-y-auto">
          <DialogHeader className="pr-8 pb-4 max-sm:pr-14 [@media(hover:none)]:pr-14">
            <DialogTitle>Generated design</DialogTitle>
            <DialogDescription>
              Built from your brand profile and brief. Pick a version to
              download or hand to the design team.
            </DialogDescription>
          </DialogHeader>

          {pending ? (
            <div
              role="status"
              className="flex flex-col items-center gap-3 py-12"
            >
              <Spinner />
              <p className="text-[14px] text-[var(--text-muted)]">
                {progressLabel ?? "Generating…"}
              </p>
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-[14px] text-[var(--status-error-fg)]">
                {error}
              </p>
            </div>
          ) : generations.length === 0 ? (
            <p className="py-10 text-center text-[14px] text-[var(--text-muted)]">
              No designs yet.
            </p>
          ) : (
            <div
              className={cn(
                "grid gap-3",
                generations.length > 1 && "sm:grid-cols-2",
              )}
            >
              {generations.map((generation) => {
                const isSelected = selected?.id === generation.id;
                /* Nothing to choose between when there is one: a disabled
                   button would drop out of the tab order and be announced as
                   unavailable, for what is really a static figure. */
                const only = generations.length === 1;
                const Wrapper = only ? "figure" : "button";
                return (
                  <Wrapper
                    key={generation.id}
                    {...(only
                      ? {}
                      : {
                          type: "button" as const,
                          onClick: () => setSelectedId(generation.id),
                          "aria-pressed": isSelected,
                        })}
                    className={cn(
                      "flex flex-col gap-2 rounded-xl border p-2 text-left transition-colors",
                      isSelected && !only
                        ? "border-[var(--border-accent)] ring-[3px] ring-[var(--accent-glow)]"
                        : "border-[var(--border)]",
                      !only && "hover:border-[var(--border-accent)]",
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
                    <span className="flex flex-wrap gap-x-2 px-1 pb-1 text-[12px] text-[var(--text-muted)]">
                      <span>{RENDERER_LABEL[generation.renderer]}</span>
                      {resolutionLabel(generation) ? (
                        <span>{resolutionLabel(generation)}</span>
                      ) : null}
                    </span>
                  </Wrapper>
                );
              })}
            </div>
          )}
        </div>

        {/* The sheet squares off its own bottom corners, so the footer must
            too, and its -mb-4 pulls it flush to the viewport edge — pb-10
            keeps the primary action clear of the home indicator. */}
        <DialogFooter className="max-sm:rounded-b-none max-sm:pb-10">
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
            /* A real link, not a Button inside an anchor: this is a file
               download, and nesting a button in an anchor is invalid content.
               Same-origin is for authorization — the filename and disposition
               come from R2 itself on the final hop, which is why linking
               straight at the object with a `download` attribute never worked:
               that attribute is ignored cross-origin. */
            /* A successful download does not navigate, but a 404 or an
               expired session returns JSON — opening it in a throwaway tab
               keeps the modal and the page the user was working in. */
            <a
              href={`/api/design/generations/${selected.id}/download`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              <Download aria-hidden="true" className="size-4" />
              {resolution ? `Download ${resolution}` : "Download"}
              <span className="sr-only"> (opens in a new tab)</span>
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
