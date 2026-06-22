"use client";

import { CalendarDays, Clock } from "lucide-react";
import Link from "next/link";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useMemo } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatTicketNumber } from "@/lib/design/ticket";
import {
  matchesTicketFilter,
  TICKET_FILTERS,
  type TicketFilter,
  type TicketStatus,
  ticketFilterLabel,
} from "@/lib/design/tickets-ui";
import { TicketStatusBadge } from "./ticket-status-badge";

export interface TicketListRow {
  id: string;
  ticketNumber: number;
  designType: string;
  status: TicketStatus;
  campaignName: string | null;
  itemTitle: string | null;
  createdAt: string;
  dueDate: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function TicketsListClient({ tickets }: { tickets: TicketListRow[] }) {
  const [filter, setFilter] = useQueryState(
    "status",
    parseAsStringLiteral(TICKET_FILTERS).withDefault("all"),
  );

  const visible = useMemo(
    () => tickets.filter((t) => matchesTicketFilter(t.status, filter)),
    [tickets, filter],
  );

  const options = TICKET_FILTERS.map((f) => ({
    label: ticketFilterLabel(f),
    value: f,
  }));

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl<TicketFilter>
        options={options}
        value={filter}
        onChange={(v) => setFilter(v)}
        className="self-start"
      />

      {visible.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-surface-1 px-6 py-10 text-center text-[14px] text-[var(--text-secondary)]">
          No tickets in this view.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((t) => (
            <li key={t.id}>
              <Link
                href={`/design-request/${t.id}`}
                className="block rounded-xl border border-[var(--border)] bg-surface-1 p-4 transition-colors hover:border-[var(--border-accent)] hover:bg-surface-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-[var(--text-muted)]">
                    {formatTicketNumber(t.ticketNumber)}
                  </span>
                  <TicketStatusBadge status={t.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[14px] font-medium text-foreground">
                    {t.designType}
                  </span>
                  {t.campaignName && (
                    <span className="text-[13px] text-[var(--text-secondary)]">
                      · {t.campaignName}
                    </span>
                  )}
                </div>
                {t.itemTitle && (
                  <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                    {t.itemTitle}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-[var(--text-muted)]">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays size={13} /> Submitted {formatDate(t.createdAt)}
                  </span>
                  {t.dueDate && (
                    <span className="inline-flex items-center gap-1.5">
                      <Clock size={13} />
                      {t.status === "delivered" ? "Delivered " : "Due "}
                      {formatDate(t.dueDate)}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
