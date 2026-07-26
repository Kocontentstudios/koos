"use client";

import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PriorityBadge } from "@/app/(dashboard)/design-request/priority-badge";
import { TicketStatusBadge } from "@/app/(dashboard)/design-request/ticket-status-badge";
import { Button } from "@/components/ui/button";
import { formatTicketNumber } from "@/lib/design/ticket";
import type { TicketPriority, TicketStatus } from "@/lib/design/tickets-ui";
import { cn } from "@/lib/utils";

export interface QueueRow {
  id: string;
  ticketNumber: number;
  designType: string;
  dimensions: string | null;
  slides: number | null;
  brief: string;
  status: TicketStatus;
  priority: TicketPriority;
  brandName: string | null;
  campaignName: string | null;
  itemTitle: string | null;
  dueDate: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "No due date";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type QueueFilter = "all" | "in_progress" | "needs_revision";

/** Tabs cover only statuses the queue query actually loads (submitted,
 * assigned, in_progress, revision_requested) — no server round-trip needed. */
const QUEUE_FILTERS: { key: QueueFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in_progress", label: "In progress" },
  { key: "needs_revision", label: "Needs revision" },
];

function matchesQueueFilter(status: TicketStatus, filter: QueueFilter) {
  switch (filter) {
    case "all":
      return true;
    case "in_progress":
      return status === "assigned" || status === "in_progress";
    case "needs_revision":
      return status === "revision_requested";
  }
}

export function QueueClient({ queue }: { queue: QueueRow[] }) {
  const [filter, setFilter] = useState<QueueFilter>("all");

  const revisionCount = useMemo(
    () => queue.filter((row) => row.status === "revision_requested").length,
    [queue],
  );

  const visible = useMemo(
    () => queue.filter((row) => matchesQueueFilter(row.status, filter)),
    [queue, filter],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {QUEUE_FILTERS.map(({ key, label }) => {
          const active = key === filter;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "bg-surface-2 text-foreground"
                  : "text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground",
              )}
            >
              {label}
              {key === "needs_revision" && (
                <span
                  className="inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                  style={{
                    color: "var(--status-pending-fg)",
                    backgroundColor:
                      "color-mix(in srgb, var(--status-pending-fg) 16%, transparent)",
                  }}
                >
                  {revisionCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-surface-1 px-6 py-12 text-center text-[14px] text-[var(--text-secondary)]">
          {queue.length === 0
            ? "The queue is empty. Nice work."
            : "No tickets in this view."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((row) => (
            <QueueItem key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function QueueItem({ row }: { row: QueueRow }) {
  const router = useRouter();
  const fileId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function action(
    label: string,
    run: () => Promise<Response>,
    successMsg?: string,
  ) {
    if (pending) return;
    setPending(label);
    setError(null);
    try {
      const res = await run();
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        const msg = data?.error ?? "Action failed. Please try again.";
        setError(msg);
        toast.error(msg);
        return;
      }
      if (successMsg) toast.success(successMsg);
      router.refresh();
    } catch {
      const msg = "Network error. Please try again.";
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(null);
    }
  }

  const claim = () =>
    action(
      "claim",
      () =>
        fetch(`/api/admin/tickets/${row.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claim: true }),
        }),
      "Ticket claimed",
    );

  const start = () =>
    action(
      "start",
      () =>
        fetch(`/api/admin/tickets/${row.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "in_progress" }),
        }),
      "Ticket started",
    );

  function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    action(
      "upload",
      () =>
        fetch(`/api/admin/tickets/${row.id}/deliverables`, {
          method: "POST",
          body: form,
        }),
      "Deliverables uploaded",
    ).finally(() => {
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <li className="rounded-xl border border-[var(--border)] bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-[var(--text-muted)]">
            {formatTicketNumber(row.ticketNumber)}
          </span>
          <TicketStatusBadge status={row.status} />
          <PriorityBadge priority={row.priority} />
        </div>
        <span className="text-[12px] text-[var(--text-muted)]">
          Due {formatDate(row.dueDate)}
        </span>
      </div>

      <div className="mt-2 space-y-0.5">
        <p className="text-[14px] font-medium text-foreground">
          {row.designType}
          {row.dimensions ? ` · ${row.dimensions}` : ""}
          {row.slides ? ` · ${row.slides} slides` : ""}
        </p>
        <p className="text-[13px] text-[var(--text-secondary)]">
          {row.brandName ?? "—"}
          {row.campaignName ? ` · ${row.campaignName}` : ""}
          {row.itemTitle ? ` · ${row.itemTitle}` : ""}
        </p>
        <p className="line-clamp-2 text-[13px] text-[var(--text-muted)]">
          {row.brief}
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-2 text-[13px] text-[var(--status-error-fg)]"
        >
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="lg"
          loading={pending === "claim"}
          loadingText="Claiming…"
          disabled={pending !== null}
          onClick={claim}
        >
          Claim
        </Button>
        <Button
          variant="secondary"
          size="lg"
          loading={pending === "start"}
          loadingText="Starting…"
          disabled={pending !== null}
          onClick={start}
        >
          Start
        </Button>
        <label
          htmlFor={fileId}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border border-[var(--border-accent)] px-2.5 text-[13px] font-semibold text-foreground hover:bg-[rgba(19,139,200,0.08)] aria-disabled:pointer-events-none aria-disabled:opacity-50"
          aria-disabled={pending !== null}
        >
          {pending === "upload" ? (
            <>
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              Uploading…
            </>
          ) : (
            "Upload deliverables"
          )}
        </label>
        <input
          id={fileId}
          ref={fileRef}
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.webp,.pdf,.zip"
          disabled={pending !== null}
          onChange={onFiles}
          className="sr-only"
        />
        <Link
          href={`/admin/tickets/${row.id}`}
          className="inline-flex h-9 items-center rounded-[10px] px-2.5 text-[13px] font-semibold text-primary hover:underline"
        >
          View / update
        </Link>
      </div>
    </li>
  );
}
