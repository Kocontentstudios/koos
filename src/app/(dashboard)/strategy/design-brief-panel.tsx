"use client";

import {
  Check,
  Copy,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Send,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { formatTicketNumber } from "@/lib/design/ticket";
import { DESIGN_TYPE_OPTIONS, isCarouselType } from "@/lib/design/tickets-ui";
import { cn } from "@/lib/utils";
import type { PersistedDesignBrief } from "./design-brief-card";

interface DesignBriefPanelProps {
  brief: PersistedDesignBrief | null;
  brandId: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Close the panel and return to the chat (the brief's card stays). */
  onClose: () => void;
  /** Persisted edits / submissions changed the brief — sync the card list. */
  onBriefUpdated: (brief: PersistedDesignBrief) => void;
  /** Mobile drawer open state (below the lg breakpoint). */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

interface CreatedTicket {
  id: string;
  ticketNumber: number;
}

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-surface-1 px-3 py-2 text-[13px] text-foreground transition-colors hover:border-[var(--border-accent)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)]";

const labelCls =
  "mb-1 block text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]";

/** Editable draft of the brief's user-facing fields. */
interface BriefDraft {
  title: string;
  designType: string;
  dimensions: string;
  slides: string;
  briefMarkdown: string;
  notes: string;
}

function draftFrom(brief: PersistedDesignBrief): BriefDraft {
  return {
    title: brief.title,
    designType: brief.designType,
    dimensions: brief.dimensions ?? "",
    slides: brief.slides ? String(brief.slides) : "",
    briefMarkdown: brief.briefMarkdown,
    notes: brief.notes ?? "",
  };
}

/** Shared header + scrollable body + footer, used by desktop aside and mobile drawer. */
function PanelContent({
  brief,
  brandId,
  onClose,
  onBriefUpdated,
  headerAction,
}: {
  brief: PersistedDesignBrief | null;
  brandId: string;
  onClose: () => void;
  onBriefUpdated: (brief: PersistedDesignBrief) => void;
  headerAction: React.ReactNode;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedTicket | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BriefDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

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
          briefId: brief.id,
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
      onBriefUpdated({ ...brief, ticketId: data.ticket.id });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSave() {
    if (!brief || !draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      const slides = draft.slides.trim() ? Number(draft.slides) : null;
      const res = await fetch(`/api/design-briefs/${brief.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          designType: draft.designType.trim(),
          dimensions: draft.dimensions.trim() || null,
          slides: isCarouselType(draft.designType) ? slides : null,
          briefMarkdown: draft.briefMarkdown,
          notes: draft.notes.trim() || null,
        }),
      });
      const data = (await res.json()) as
        | { brief: PersistedDesignBrief }
        | { error: string };
      if (!res.ok || !("brief" in data)) {
        setError(
          ("error" in data && data.error) ||
            "Could not save your changes. Please try again.",
        );
        return;
      }
      onBriefUpdated(data.brief);
      setEditing(false);
      setDraft(null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(brief.briefMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to the clipboard.");
    }
  }

  function startEditing() {
    if (!brief) return;
    setEditing(true);
    setError(null);
    setDraft(draftFrom(brief));
  }

  const knownType =
    !!brief &&
    (DESIGN_TYPE_OPTIONS.includes(brief.designType) ||
      (!!draft && DESIGN_TYPE_OPTIONS.includes(draft.designType)));

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
        ) : editing && draft ? (
          <div className="flex flex-col gap-4 py-3">
            <div>
              <label className={labelCls} htmlFor="brief-title">
                Title
              </label>
              <input
                id="brief-title"
                className={inputCls}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="brief-design-type">
                Design type
              </label>
              {knownType ? (
                <select
                  id="brief-design-type"
                  className={inputCls}
                  value={draft.designType}
                  onChange={(e) =>
                    setDraft({ ...draft, designType: e.target.value })
                  }
                >
                  {DESIGN_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="brief-design-type"
                  className={inputCls}
                  value={draft.designType}
                  onChange={(e) =>
                    setDraft({ ...draft, designType: e.target.value })
                  }
                />
              )}
            </div>
            <div>
              <label className={labelCls} htmlFor="brief-dimensions">
                Dimensions
              </label>
              <input
                id="brief-dimensions"
                className={inputCls}
                placeholder="e.g. 1080x1350"
                value={draft.dimensions}
                onChange={(e) =>
                  setDraft({ ...draft, dimensions: e.target.value })
                }
              />
            </div>
            {isCarouselType(draft.designType) && (
              <div>
                <label className={labelCls} htmlFor="brief-slides">
                  Slides
                </label>
                <input
                  id="brief-slides"
                  className={inputCls}
                  type="number"
                  min={2}
                  max={10}
                  value={draft.slides}
                  onChange={(e) =>
                    setDraft({ ...draft, slides: e.target.value })
                  }
                />
              </div>
            )}
            <div>
              <label className={labelCls} htmlFor="brief-markdown">
                Brief
              </label>
              <textarea
                id="brief-markdown"
                className={cn(inputCls, "min-h-[220px] font-mono")}
                value={draft.briefMarkdown}
                onChange={(e) =>
                  setDraft({ ...draft, briefMarkdown: e.target.value })
                }
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="brief-notes">
                Notes for the designer
              </label>
              <textarea
                id="brief-notes"
                className={cn(inputCls, "min-h-[80px]")}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
          </div>
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
          {error && (
            <p className="rounded-lg bg-[var(--status-error-bg)] px-3 py-2 text-[13px] text-[var(--status-error-fg)]">
              {error}
            </p>
          )}
          {editing ? (
            <>
              <Button
                variant="default"
                onClick={handleSave}
                loading={saving}
                loadingText="Saving…"
                disabled={!draft?.title.trim() || !draft?.briefMarkdown.trim()}
                className="w-full justify-center"
              >
                <Check className="size-4" />
                Save Changes
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setDraft(null);
                  setError(null);
                }}
                className="w-full justify-center"
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              {created && (
                <p className="flex items-center gap-2 rounded-lg bg-[var(--status-ready-bg)] px-3 py-2 text-[13px] font-medium text-[var(--status-ready-fg)]">
                  <Check className="size-4 shrink-0" />
                  Request {formatTicketNumber(created.ticketNumber)} sent to the
                  KO design team.
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
                {created || brief.ticketId ? "Submit Again" : "Request Design"}
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={startEditing}
                  aria-label="Edit brief"
                  className="flex-1 justify-center"
                >
                  <Pencil className="size-4" />
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleCopy}
                  aria-label="Copy brief"
                  className="flex-1 justify-center"
                >
                  <Copy className="size-4" />
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
              {created ? (
                <Link href="/design-request" className="w-full">
                  <Button variant="secondary" className="w-full justify-center">
                    View My Tickets
                  </Button>
                </Link>
              ) : (
                <Button
                  variant="secondary"
                  onClick={onClose}
                  className="w-full justify-center"
                >
                  Refine in chat
                </Button>
              )}
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
  onClose,
  onBriefUpdated,
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
            key={brief?.id ?? "empty"}
            brief={brief}
            brandId={brandId}
            onClose={onClose}
            onBriefUpdated={onBriefUpdated}
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
          key={brief?.id ?? "empty"}
          brief={brief}
          brandId={brandId}
          onClose={onClose}
          onBriefUpdated={onBriefUpdated}
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
