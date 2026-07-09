"use client";

import { Loader2Icon, MessageSquare, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface StrategyHistoryItem {
  id: string;
  name: string;
  updatedAt: Date;
  status?: string;
}

export interface ConversationListItem {
  id: string;
  title: string | null;
  updatedAt: Date;
}

interface StrategyHistoryProps {
  pastStrategies: StrategyHistoryItem[];
  /** Currently-loaded strategy, highlighted in the list. */
  activeId: string | null;
  /** Strategy currently being fetched, shows a spinner on that row. */
  loadingId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** When provided, renders a close button (mobile drawer). */
  onClose?: () => void;
  /** Past chat conversations (persisted); click to reopen one. */
  conversations?: ConversationListItem[];
  activeConversationId?: string | null;
  loadingConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
}

function conversationLabel(c: ConversationListItem): string {
  if (c.title) return c.title;
  return `Chat from ${new Date(c.updatedAt).toLocaleDateString()}`;
}

export function StrategyHistory({
  pastStrategies,
  activeId,
  loadingId,
  onSelect,
  onNew,
  onClose,
  conversations = [],
  activeConversationId = null,
  loadingConversationId = null,
  onSelectConversation,
}: StrategyHistoryProps) {
  return (
    <>
      <div className="border-b border-[var(--border)] px-5 py-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-foreground">
            Campaign History
          </h3>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close history"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <Button
          variant="default"
          onClick={onNew}
          className="w-full justify-center"
        >
          <Plus className="size-4" />
          New Strategy
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {onSelectConversation && conversations.length > 0 && (
          <div className="mb-3">
            <h4 className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Recent Chats
            </h4>
            <ul className="space-y-1">
              {conversations.map((c) => {
                const active = c.id === activeConversationId;
                const loading = c.id === loadingConversationId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onSelectConversation(c.id)}
                      disabled={loading}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-70",
                        active && "border-l-2 border-l-primary bg-surface-2",
                      )}
                    >
                      <MessageSquare
                        size={13}
                        className="mt-0.5 shrink-0 text-[var(--text-muted)]"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-foreground">
                          {conversationLabel(c)}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                          {new Date(c.updatedAt).toLocaleDateString()}
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
                  </li>
                );
              })}
            </ul>
            <div className="mx-2 mt-3 h-px bg-[var(--divider)]" />
          </div>
        )}
        {onSelectConversation && conversations.length > 0 && (
          <h4 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Strategies
          </h4>
        )}
        {pastStrategies.length === 0 ? (
          <p className="px-2 py-3 text-[13px] text-[var(--text-secondary)]">
            No strategies yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {pastStrategies.map((s) => {
              const active = s.id === activeId || s.status === "active";
              const loading = s.id === loadingId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    disabled={loading}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "w-full rounded-lg px-3 py-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-70",
                      active && "border-l-2 border-l-primary bg-surface-2",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-semibold text-foreground">
                        {s.name}
                      </p>
                      {loading && (
                        <Loader2Icon
                          size={13}
                          className="shrink-0 animate-spin text-[var(--text-muted)]"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] capitalize text-[var(--text-muted)]">
                      {s.status ?? "draft"}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      {new Date(s.updatedAt).toLocaleDateString()}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
