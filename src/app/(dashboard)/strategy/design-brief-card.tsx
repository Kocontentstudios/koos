"use client";

import { Check, FileText } from "lucide-react";

/** A design_briefs row as the API serializes it. */
export interface PersistedDesignBrief {
  id: string;
  title: string;
  designType: string;
  dimensions: string | null;
  slides: number | null;
  briefMarkdown: string;
  notes: string | null;
  /** Most recent design ticket submitted from this brief, if any. */
  ticketId: string | null;
  createdAt: string;
}

interface DesignBriefCardProps {
  brief: PersistedDesignBrief;
  onOpen: (briefId: string) => void;
}

/** Clickable card pinned into the design-mode chat for every generated
 * brief, so a brief can be reopened, edited, and resubmitted later without
 * regenerating it. */
export function DesignBriefCard({ brief, onOpen }: DesignBriefCardProps) {
  const meta = [
    brief.designType,
    brief.dimensions,
    brief.slides ? `${brief.slides} slides` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={() => onOpen(brief.id)}
      aria-label={`Open design brief: ${brief.title}`}
      className="flex w-full max-w-[480px] items-start gap-3 rounded-xl border border-[var(--border-accent)] bg-surface-1 px-4 py-3 text-left transition-colors hover:bg-[var(--hover)]"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-glow)] text-primary">
        <FileText size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="inline-block rounded-full bg-[var(--accent-glow)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
            Design Brief
          </span>
          {brief.ticketId && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--status-ready-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--status-ready-fg)]">
              <Check className="size-3" />
              Sent to design team
            </span>
          )}
        </span>
        <span className="mt-1 block truncate text-[14px] font-semibold text-foreground">
          {brief.title}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-[var(--text-muted)]">
          {meta}
        </span>
      </span>
    </button>
  );
}
