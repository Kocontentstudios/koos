"use client";

import { Loader2Icon, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface StrategyHistoryItem {
  id: string;
  name: string;
  updatedAt: Date;
  status?: string;
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
}

export function StrategyHistory({
  pastStrategies,
  activeId,
  loadingId,
  onSelect,
  onNew,
  onClose,
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
