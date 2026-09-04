"use client";

import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryStates } from "nuqs";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { PriorityBadge } from "@/app/(dashboard)/design-request/priority-badge";
import { TicketStatusBadge } from "@/app/(dashboard)/design-request/ticket-status-badge";
import { Button } from "@/components/ui/button";
import { rowActionsFor } from "@/lib/admin/scope";
import { adminScopeParsers } from "@/lib/admin/scope-params";
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
  /** The assignment itself. Actions gate on THIS, never on the display name: a
   *  designer with no first or last name renders as "" and would silently lose
   *  every action that only fires on an assigned ticket. */
  designerId: string | null;
  assigneeName: string;
  /** How long past due, already formatted. Null when not overdue: an operator
   *  reads "3 days", not a timestamp they have to subtract. */
  overdueFor: string | null;
}

export interface Assignee {
  id: string;
  name: string;
  role: string;
}

export interface WorkloadHeader {
  name: string;
  active: number;
  overdue: number;
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

/* Derived from the shared vocabulary rather than redeclared, so the search box
   cannot drift from the grammar the server parses. */
const searchParsers = {
  q: adminScopeParsers.q,
  page: adminScopeParsers.page,
};

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
  page,
  pages,
  prevHref,
  nextHref,
  workload,
  assignees,
  canAssign,
  emptyMessage = "No tickets in this view.",
}: {
  queue: QueueRow[];
  filters: QueueFilterLink[];
  total?: number;
  page: number;
  pages: number;
  prevHref: string | null;
  nextHref: string | null;
  workload: WorkloadHeader | null;
  assignees: Assignee[];
  canAssign: boolean;
  emptyMessage?: string;
}) {
  /* shallow:false means each search is a real server round-trip, so it needs a
     real affordance. The transition's pending flag drives it. */
  const [isPending, startTransition] = useTransition();
  const [{ q }, setQuery] = useQueryStates(searchParsers, {
    shallow: false,
    startTransition,
  });
  const [draft, setDraft] = useState(q);
  const searchId = useId();
  /* Back/Forward changes `q` without touching local state, leaving the box
     showing a term the URL and the results no longer carry. */
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    setDraft(q);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    // Back to page 1: the old offset is meaningless against a new result set.
    setQuery({ q: draft.trim() || null, page: null });
  }

  return (
    <div className="flex flex-col gap-4">
      {workload && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border border-[var(--border)] bg-surface-1 px-4 py-3">
          <span className="text-[15px] font-semibold text-foreground">
            {workload.name}
          </span>
          <span className="text-[13px] text-[var(--text-secondary)] tabular-nums">
            {workload.active} active
          </span>
          {workload.overdue > 0 && (
            <span className="text-[13px] font-medium text-[var(--status-error-fg)] tabular-nums">
              {workload.overdue} overdue
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {filters.map(({ key, label, href, active, count }) => (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors",
              /* Not bg-surface-2: it is #ffffff in light mode, so the active
                 tab would be indistinguishable from the page behind it. */
              active
                ? "bg-[var(--hover)] text-foreground ring-1 ring-[var(--border-accent)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground",
            )}
          >
            {label}
            {count !== undefined && count > 0 && (
              /* Outlined, not tinted. The count is 11px semibold — normal
                 text under WCAG 1.4.3, so it needs 4.5:1. On a 16% tint of its
                 own colour it measured 3.98:1 in light mode; unfilled on the
                 card it is 4.92:1. The border carries the badge shape and is
                 decorative, so 1.4.11 does not apply to it. */
              <span
                className="inline-flex min-w-5 items-center justify-center rounded-full border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                style={{
                  color: "var(--status-pending-fg)",
                  borderColor: "var(--status-pending-fg)",
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

      <form onSubmit={submitSearch} className="flex items-center gap-2">
        <label htmlFor={searchId} className="sr-only">
          Search tickets
        </label>
        <input
          id={searchId}
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ticket number, title, brief, brand or requester"
          className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[13px] text-foreground placeholder:text-[var(--text-muted)] focus:border-primary focus:outline-none"
        />
        <Button type="submit" variant="secondary" size="lg" loading={isPending}>
          Search
        </Button>
        {q && (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => {
              setDraft("");
              setQuery({ q: null, page: null });
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {/* Mounted always, text swapped — a live region created in the same
          commit as its content is frequently not announced. Never aria-busy:
          marking a live region busy tells assistive tech to withhold the very
          update it exists to deliver. */}
      <p
        role="status"
        className="min-h-4 text-[13px] text-[var(--text-secondary)]"
      >
        {isPending ? "Updating results…" : ""}
      </p>

      {queue.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-surface-1 px-6 py-12 text-center text-[14px] text-[var(--text-secondary)]">
          {emptyMessage}
        </p>
      ) : (
        <ul
          className={cn(
            "flex flex-col gap-3 transition-opacity",
            isPending && "opacity-60",
          )}
        >
          {queue.map((row) => (
            <QueueItem
              key={row.id}
              row={row}
              assignees={assignees}
              canAssign={canAssign}
            />
          ))}
        </ul>
      )}

      {/* Also when `page > pages`: someone who edited the URL past the end
          needs a way back, and hiding the pager there left only the URL bar. */}
      {(pages > 1 || page > pages) && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-3"
        >
          <PagerLink href={prevHref}>← Previous</PagerLink>
          <span className="text-[12px] text-[var(--text-muted)] tabular-nums">
            Page {page} of {pages}
          </span>
          <PagerLink href={nextHref}>Next →</PagerLink>
        </nav>
      )}
    </div>
  );
}

function PagerLink({
  href,
  children,
}: {
  href: string | null;
  children: React.ReactNode;
}) {
  const className =
    "inline-flex h-9 items-center rounded-[10px] border border-[var(--border)] px-3 text-[13px] font-semibold";
  if (!href) {
    return (
      <span aria-disabled="true" className={cn(className, "opacity-40")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={cn(className, "hover:bg-[var(--hover)]")}>
      {children}
    </Link>
  );
}

function QueueItem({
  row,
  assignees,
  canAssign,
}: {
  row: QueueRow;
  assignees: Assignee[];
  canAssign: boolean;
}) {
  const router = useRouter();
  const fileId = useId();
  const assignId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* The list now spans every status, including drafts and signed-off work.
     Offering Start on an approved ticket reopens it and emails the client. */
  const can = rowActionsFor(row.status, row.designerId);

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

  const assign = (designerId: string) =>
    action(
      "assign",
      () =>
        fetch(`/api/admin/tickets/${row.id}/manage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignedDesignerId: designerId || null }),
        }),
      designerId ? "Ticket assigned" : "Ticket unassigned",
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
        <p className="text-[12px] text-[var(--text-muted)]">
          {row.assigneeName || "Unassigned"}
        </p>
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
        {canAssign && can.assign && (
          <span className="inline-flex items-center gap-1.5">
            <label htmlFor={assignId} className="sr-only">
              {`Assign ${formatTicketNumber(row.ticketNumber)}`}
            </label>
            <select
              id={assignId}
              value={row.designerId ?? ""}
              disabled={pending !== null}
              onChange={(e) => assign(e.target.value)}
              className="h-9 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-[13px] text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
            >
              <option value="">Unassigned</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {pending === "assign" && (
              <Loader2Icon
                className="size-4 animate-spin text-[var(--text-muted)]"
                aria-hidden="true"
              />
            )}
          </span>
        )}

        {can.remind ? (
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
        {can.claim && (
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
        )}
        {can.start && (
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
        )}
        {can.upload && (
          <>
            <label
              htmlFor={fileId}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border border-[var(--border-accent)] px-2.5 text-[13px] font-semibold text-foreground hover:bg-[rgba(19,139,200,0.08)] aria-disabled:pointer-events-none aria-disabled:opacity-50"
              aria-disabled={pending !== null}
            >
              {pending === "upload" ? (
                <>
                  <Loader2Icon
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
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
          </>
        )}
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
