"use client";

import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
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
  /** The ticket's own title, when it has one — a design request names itself
   *  before a calendar item does. */
  title: string | null;
  assigneeName: string | null;
  /** How long past due, already formatted. Null when not overdue: an operator
   *  reads "3 days", not a timestamp they have to subtract. */
  overdueFor: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "No due date";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export interface QueueFilterLink {
  key: string;
  label: string;
  href: string;
  active: boolean;
  count?: number;
}

/**
 * The filter set lives in the URL, not in component state.
 *
 * A drill-down from the dashboard is a link, and a link has to land on a
 * filtered list. Local state also filters only the rows already fetched, which
 * on a paginated list quietly searches one page and looks like it worked.
 */
export function QueueClient({
  queue,
  filters,
  total,
  emptyMessage = "No tickets in this view.",
}: {
  queue: QueueRow[];
  filters: QueueFilterLink[];
  total?: number;
  emptyMessage?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map(({ key, label, href, active, count }) => (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors",
              active
                ? "bg-surface-2 text-foreground"
                : "text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground",
            )}
          >
            {label}
            {count !== undefined && count > 0 && (
              <span
                className="inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                style={{
                  color: "var(--status-pending-fg)",
                  backgroundColor:
                    "color-mix(in srgb, var(--status-pending-fg) 16%, transparent)",
                }}
              >
                {count}
              </span>
            )}
          </Link>
        ))}
        {total !== undefined && (
          <span className="ml-auto text-[12px] text-[var(--text-muted)] tabular-nums">
            {total} {total === 1 ? "ticket" : "tickets"}
          </span>
        )}
      </div>

      {queue.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-surface-1 px-6 py-12 text-center text-[14px] text-[var(--text-secondary)]">
          {emptyMessage}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {queue.map((row) => (
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
        <span className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
          {row.overdueFor && (
            <span className="rounded-full bg-[var(--status-error-bg)] px-2 py-0.5 font-medium text-[var(--status-error-fg)]">
              {row.overdueFor} overdue
            </span>
          )}
          Due {formatDate(row.dueDate)}
        </span>
      </div>

      <div className="mt-2 space-y-0.5">
        {row.assigneeName !== null && (
          <p className="text-[12px] text-[var(--text-muted)]">
            {row.assigneeName || "Unassigned"}
          </p>
        )}
        <p className="text-[14px] font-medium text-foreground">
          {row.title ?? row.designType}
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
        {/* Only where it means something: nudging an unassigned ticket has
            nobody to reach, and the route refuses it. */}
        {row.assigneeName ? (
          <Button
            variant="secondary"
            size="lg"
            loading={pending === "remind"}
            loadingText="Sending…"
            disabled={pending !== null}
            onClick={() =>
              action(
                "remind",
                () =>
                  fetch(`/api/admin/tickets/${row.id}/remind`, {
                    method: "POST",
                  }),
                "Reminder sent",
              )
            }
          >
            Send reminder
          </Button>
        ) : null}
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
