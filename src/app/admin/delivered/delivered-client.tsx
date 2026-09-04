"use client";

import Link from "next/link";
import { useQueryStates } from "nuqs";
import { useId, useState, useTransition } from "react";
import { TicketStatusBadge } from "@/app/(dashboard)/design-request/ticket-status-badge";
import { Button } from "@/components/ui/button";
import { adminScopeParsers } from "@/lib/admin/scope-params";
import { formatTicketNumber } from "@/lib/design/ticket";
import type { TicketStatus } from "@/lib/design/tickets-ui";
import { cn } from "@/lib/utils";

export interface DeliveredRow {
  id: string;
  ticketNumber: number;
  title: string;
  brandName: string | null;
  requesterName: string;
  designerName: string;
  /** Already formatted: the table shows dates, not timestamps to subtract. */
  deliveredOn: string | null;
  approvedOn: string | null;
  status: TicketStatus;
}

export interface DeliveredFilter {
  key: string;
  label: string;
  href: string;
  active: boolean;
}

const searchParsers = {
  q: adminScopeParsers.q,
  page: adminScopeParsers.page,
};

/**
 * Delivered work, as a table.
 *
 * Eight columns is a table, not a card list — the operator is scanning for one
 * ticket across many, and a card grid makes that a reading task instead of a
 * scanning one. It scrolls inside its own container so the page never scrolls
 * sideways.
 */
export function DeliveredClient({
  rows,
  filters,
  total,
  page,
  pages,
  prevHref,
  nextHref,
  emptyMessage,
}: {
  rows: DeliveredRow[];
  filters: DeliveredFilter[];
  total: number;
  page: number;
  pages: number;
  prevHref: string | null;
  nextHref: string | null;
  emptyMessage: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [{ q }, setQuery] = useQueryStates(searchParsers, {
    shallow: false,
    startTransition,
  });
  const [draft, setDraft] = useState(q);
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    setDraft(q);
  }
  const searchId = useId();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map(({ key, label, href, active }) => (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center rounded-lg px-4 py-2 text-[13px] font-medium transition-colors",
              active
                ? "bg-[var(--hover)] text-foreground ring-1 ring-[var(--border-accent)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
        <span className="ml-auto text-[12px] text-[var(--text-muted)] tabular-nums">
          {total} {total === 1 ? "project" : "projects"}
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ q: draft.trim() || null, page: null });
        }}
        className="flex items-center gap-2"
      >
        <label htmlFor={searchId} className="sr-only">
          Search delivered work
        </label>
        <input
          id={searchId}
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ticket number, title, brand, requester or designer"
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

      <p
        role="status"
        className="min-h-4 text-[13px] text-[var(--text-secondary)]"
      >
        {isPending ? "Updating results…" : ""}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-surface-1 px-6 py-12 text-center text-[14px] text-[var(--text-secondary)]">
          {emptyMessage}
        </p>
      ) : (
        <div
          className={cn(
            "overflow-x-auto rounded-xl border border-[var(--border)] bg-surface-1 transition-opacity",
            isPending && "opacity-60",
          )}
        >
          <table className="w-full min-w-[52rem] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[12px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-3 font-medium">Ticket</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Brand</th>
                <th className="px-4 py-3 font-medium">Requester</th>
                <th className="px-4 py-3 font-medium">Designer</th>
                <th className="px-4 py-3 font-medium">Delivered</th>
                <th className="px-4 py-3 font-medium">Approved</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-[var(--border)] text-foreground"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--text-muted)] tabular-nums">
                    {formatTicketNumber(row.ticketNumber)}
                  </td>
                  <td className="px-4 py-3">{row.title}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {row.brandName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {row.requesterName || "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {row.designerName || "Unassigned"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--text-secondary)] tabular-nums">
                    {row.deliveredOn ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--text-secondary)] tabular-nums">
                    {row.approvedOn ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <TicketStatusBadge status={row.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {/* Names the ticket, so a screen reader hears which row's
                        link this is rather than nine identical "View ticket"s. */}
                    <Link
                      href={`/admin/tickets/${row.id}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      View
                      <span className="sr-only">
                        {` ${formatTicketNumber(row.ticketNumber)}`}
                      </span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
