"use client";

import { Check, Loader2Icon, MessageSquare, Pencil, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { MAX_CONVERSATION_TITLE } from "./conversation-title";

export interface ConversationListItem {
  id: string;
  title: string | null;
  updatedAt: Date;
  mode?: "strategy" | "design";
  /** Latest strategy generated in this chat, if any. */
  strategyId?: string | null;
  /** The user named this chat, so nothing automatic may rename it. */
  titleCustom?: boolean;
}

export function conversationLabel(c: ConversationListItem): string {
  if (c.title) return c.title;
  return `Chat from ${new Date(c.updatedAt).toLocaleDateString()}`;
}

interface ConversationRowProps {
  conversation: ConversationListItem;
  active: boolean;
  loading: boolean;
  onSelect: (id: string) => void;
  onRename?: (id: string, title: string) => Promise<boolean>;
}

/**
 * One chat in the history list. The rename control is a sibling of the select
 * button, never nested inside it — a button inside a button is invalid and
 * swallows the click on the row.
 */
export function ConversationRow({
  conversation,
  active,
  loading,
  onSelect,
  onRename,
}: ConversationRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = conversationLabel(conversation);

  const startEditing = () => {
    setDraft(conversation.title ?? "");
    setError(null);
    setEditing(true);
  };

  const commit = async () => {
    if (!onRename || saving) return;
    const title = draft.trim();
    if (!title) {
      setError("Give the chat a name.");
      return;
    }
    if (title === conversation.title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onRename(conversation.id, title);
    setSaving(false);
    if (ok) {
      setEditing(false);
      return;
    }
    setError("Could not rename this chat.");
  };

  if (editing) {
    return (
      <li>
        <div className="flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1.5">
          <input
            // biome-ignore lint/a11y/noAutofocus: the pencil press is itself the request to type
            autoFocus
            value={draft}
            maxLength={MAX_CONVERSATION_TITLE}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            aria-label={`Rename chat: ${label}`}
            aria-invalid={error ? "true" : undefined}
            disabled={saving}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-[var(--text-muted)]"
          />
          <button
            type="button"
            onClick={() => void commit()}
            disabled={saving}
            aria-label="Save chat name"
            className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground disabled:opacity-60"
          >
            {saving ? (
              <Loader2Icon size={13} className="animate-spin" />
            ) : (
              <Check size={13} />
            )}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            aria-label="Cancel rename"
            className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
          >
            <X size={13} />
          </button>
        </div>
        {error && (
          <p
            role="alert"
            className="px-2 pt-1 text-[11px] text-[var(--status-error-fg)]"
          >
            {error}
          </p>
        )}
      </li>
    );
  }

  return (
    <li className="group/row relative">
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        disabled={loading}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-70",
          active && "border-l-2 border-l-primary bg-surface-2",
          onRename && "pr-9",
        )}
      >
        <MessageSquare
          size={13}
          className="mt-0.5 shrink-0 text-[var(--text-muted)]"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-foreground">
            {label}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            {new Date(conversation.updatedAt).toLocaleDateString()}
            {conversation.mode === "design" && (
              <span className="rounded-full bg-[var(--accent-glow)] px-1.5 py-px text-[10px] font-medium text-primary">
                Design
              </span>
            )}
            {conversation.strategyId && (
              <span className="rounded-full bg-[var(--accent-glow)] px-1.5 py-px text-[10px] font-medium text-primary">
                Campaign
              </span>
            )}
          </span>
        </span>
        {loading && (
          <Loader2Icon
            size={13}
            className="mt-0.5 shrink-0 animate-spin text-[var(--text-muted)]"
            aria-hidden="true"
          />
        )}
      </button>
      {onRename && !loading && (
        <button
          type="button"
          onClick={startEditing}
          aria-label={`Rename chat: ${label}`}
          /* Always visible on touch, where there is no hover to reveal it. */
          className="absolute right-2 top-2 flex size-6 items-center justify-center rounded text-[var(--text-muted)] transition-opacity hover:bg-[var(--hover)] hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100"
        >
          <Pencil size={12} />
        </button>
      )}
    </li>
  );
}
