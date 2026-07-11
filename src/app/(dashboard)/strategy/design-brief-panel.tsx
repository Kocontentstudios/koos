"use client";

import { Check, PanelRightClose, PanelRightOpen, Send, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import type { DesignBrief } from "@/lib/ai/design-brief-schema";
import { formatTicketNumber } from "@/lib/design/ticket";
import { cn } from "@/lib/utils";

interface DesignBriefPanelProps {
  brief: DesignBrief | null;
  brandId: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Return to the chat to refine the request (clears the brief). */
  onEdit: () => void;
  /** Mobile drawer open state (below the lg breakpoint). */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

interface CreatedTicket {
  ticketNumber: number;
}

/** Shared header + scrollable body + footer, used by desktop aside and mobile drawer. */
function PanelContent({
  brief,
  brandId,
  onEdit,
  headerAction,
}: {
  brief: DesignBrief | null;
  brandId: string;
  onEdit: () => void;
  headerAction: React.ReactNode;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedTicket | null>(null);

  async function handleSubmit() {
    if (!brief || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/design-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          calendarItemId: null,
          designType: brief.designType,
          dimensions: brief.dimensions ?? null,
          slides: brief.slides ?? null,
          brief: brief.briefMarkdown,
          notes: brief.notes ?? null,
        }),
      });
      const data = (await res.json()) as
        | { ticket: CreatedTicket }
        | { error: string };
      if (!res.ok || !("ticket" in data)) {
        setError(
          ("error" in data && data.error) ||
            "Could not submit your request. Please try again.",
        );
        return;
      }
      setCreated(data.ticket);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
        <h3 className="text-[14px] font-semibold text-foreground">
          Design Brief
        </h3>
        {headerAction}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {!brief ? (
          <p className="px-1 py-3 text-[13px] leading-relaxed text-[var(--text-muted)]">
            Your design brief will appear here once KO has gathered the details
            of your request.
          </p>
        ) : (
          <>
            <div className="py-3">
              <span className="inline-block rounded-full bg-[var(--accent-glow)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-primary">
                Design Request
              </span>
              <h4 className="mt-2 text-[16px] font-semibold text-foreground">
                {brief.title}
              </h4>
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                {brief.designType}
                {brief.dimensions ? ` · ${brief.dimensions}` : ""}
                {brief.slides ? ` · ${brief.slides} slides` : ""}
              </p>
            </div>
            <div className="border-t border-[var(--divider)] py-3">
              <Markdown className="text-[13px]">{brief.briefMarkdown}</Markdown>
            </div>
            {brief.notes && (
              <div className="border-t border-[var(--divider)] py-3">
                <h5 className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Notes for the designer
                </h5>
                <p className="text-[13px] text-[var(--text-secondary)]">
                  {brief.notes}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {brief && (
        <div className="flex flex-col gap-2 border-t border-[var(--border)] p-4">
          {created ? (
            <>
              <p className="flex items-center gap-2 rounded-lg bg-[var(--status-ready-bg)] px-3 py-2 text-[13px] font-medium text-[var(--status-ready-fg)]">
                <Check className="size-4 shrink-0" />
                Request {formatTicketNumber(created.ticketNumber)} sent to the
                KO design team.
              </p>
              <Link href="/design-request" className="w-full">
                <Button variant="secondary" className="w-full justify-center">
                  View My Tickets
                </Button>
              </Link>
            </>
          ) : (
            <>
              {error && (
                <p className="rounded-lg bg-[var(--status-error-bg)] px-3 py-2 text-[13px] text-[var(--status-error-fg)]">
                  {error}
                </p>
              )}
              <Button
                variant="default"
                onClick={handleSubmit}
                loading={submitting}
                loadingText="Submitting…"
                className="w-full justify-center"
              >
                <Send className="size-4" />
                Request Design
              </Button>
              <Button
                variant="secondary"
                onClick={onEdit}
                className="w-full justify-center"
              >
                Refine in chat
              </Button>
            </>
          )}
        </div>
      )}
    </>
  );
}

export function DesignBriefPanel({
  brief,
  brandId,
  collapsed,
  onToggleCollapsed,
  onEdit,
  mobileOpen,
  onMobileClose,
}: DesignBriefPanelProps) {
  return (
    <>
      {/* Desktop: collapsed rail */}
      {collapsed && (
        <aside className="hidden w-12 shrink-0 flex-col items-center border-l border-[var(--border)] py-4 lg:flex">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Expand design brief panel"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
          >
            <PanelRightOpen size={18} />
          </button>
          <span className="mt-4 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)] [writing-mode:vertical-rl]">
            Brief
          </span>
        </aside>
      )}

      {/* Desktop: expanded panel */}
      {!collapsed && (
        <aside className="hidden w-[320px] shrink-0 flex-col border-l border-[var(--border)] lg:flex">
          <PanelContent
            brief={brief}
            brandId={brandId}
            onEdit={onEdit}
            headerAction={
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label="Collapse design brief panel"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
              >
                <PanelRightClose size={16} />
              </button>
            }
          />
        </aside>
      )}

      {/* Mobile: right-side drawer */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close design brief"
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-[var(--backdrop)] lg:hidden"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-[var(--border)] bg-surface-1 transition-transform duration-200 lg:hidden",
          mobileOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <PanelContent
          brief={brief}
          brandId={brandId}
          onEdit={onEdit}
          headerAction={
            <button
              type="button"
              onClick={onMobileClose}
              aria-label="Close design brief"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
            >
              <X size={16} />
            </button>
          }
        />
      </aside>
    </>
  );
}
