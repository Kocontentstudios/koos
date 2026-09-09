"use client";

import { Loader2Icon, PanelLeftClose, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type ConversationListItem, ConversationRow } from "./conversation-row";

export type { ConversationListItem };

export interface StrategyHistoryItem {
  id: string;
  name: string;
  updatedAt: Date;
  status?: string;
  /** The chat this strategy was built in, when it still has one. */
  conversationId?: string | null;
}

interface StrategyHistoryProps {
  /** Strategies not reachable through a listed chat (no/old conversation). */
  olderStrategies: StrategyHistoryItem[];
  /** Currently-loaded strategy, highlighted in the list. */
  activeId: string | null;
  /** Strategy currently being fetched, shows a spinner on that row. */
  loadingId: string | null;
  onSelect: (id: string, conversationId?: string | null) => void;
  onNew: () => void;
  /** When provided, renders a close button (mobile drawer). */
  onClose?: () => void;
  /** When provided, renders a collapse button (desktop panel). */
  onCollapse?: () => void;
  /** Past chat conversations (persisted); click to reopen one. */
  conversations?: ConversationListItem[];
  activeConversationId?: string | null;
  loadingConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  /** Resolves true when the rename stuck, so the row can revert on failure. */
  onRenameConversation?: (id: string, title: string) => Promise<boolean>;
}

export function StrategyHistory({
  olderStrategies,
  activeId,
  loadingId,
  onSelect,
  onNew,
  onClose,
  onCollapse,
  conversations = [],
  activeConversationId = null,
  loadingConversationId = null,
  onSelectConversation,
  onRenameConversation,
}: StrategyHistoryProps) {
  return (
    <>
      <div className="border-b border-[var(--border)] px-5 py-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-foreground">
            Campaign History
          </h3>
          <div className="flex items-center gap-1">
            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                aria-label="Collapse history panel"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
              >
                <PanelLeftClose size={16} />
              </button>
            )}
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
        </div>
        <Button
          variant="default"
          onClick={onNew}
          className="w-full justify-center"
        >
          <Plus className="size-4" />
          New Chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        <h4 className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          Recent Chats
        </h4>
        {onSelectConversation && conversations.length > 0 ? (
          <ul className="space-y-1">
            {conversations.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                active={c.id === activeConversationId}
                loading={c.id === loadingConversationId}
                onSelect={onSelectConversation}
                onRename={onRenameConversation}
              />
            ))}
          </ul>
        ) : (
          <p className="px-2 py-3 text-[13px] text-[var(--text-secondary)]">
            No chats yet.
          </p>
        )}

        {olderStrategies.length > 0 && (
          <>
            <div className="mx-2 mt-3 h-px bg-[var(--divider)]" />
            <h4 className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Older Strategies
            </h4>
            <ul className="space-y-1">
              {olderStrategies.map((s) => {
                const active = s.id === activeId;
                const loading = s.id === loadingId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(s.id, s.conversationId)}
                      disabled={loading}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-70",
                        active && "border-l-2 border-l-primary bg-surface-2",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] text-foreground">
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
                      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                        <span className="capitalize">
                          {s.status ?? "draft"}
                        </span>
                        {" · "}
                        {new Date(s.updatedAt).toLocaleDateString()}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
