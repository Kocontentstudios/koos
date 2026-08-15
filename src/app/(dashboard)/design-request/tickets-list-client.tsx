"use client";

import { CalendarDays, Clock, ImageIcon } from "lucide-react";
import Link from "next/link";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useMemo } from "react";
import { formatTicketNumber } from "@/lib/design/ticket";
import {
  matchesTicketFilter,
  needsClientReview,
  TICKET_FILTERS,
  type TicketStatus,
  ticketFilterLabel,
} from "@/lib/design/tickets-ui";
import { cn } from "@/lib/utils";
import { TicketStatusBadge } from "./ticket-status-badge";

export interface TicketListRow {
  id: string;
  ticketNumber: number;
  designType: string;
  title: string | null;
  slides: number | null;
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

  const awaitingReviewCount = useMemo(
    () => tickets.filter((t) => needsClientReview(t.status)).length,
    [tickets],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Filter tabs — bare text buttons per template (design-tickets.html) */}
      <div className="flex flex-wrap gap-2">
        {TICKET_FILTERS.map((f) => {
          const active = f === filter;
          const badgeCount = f === "needs_review" ? awaitingReviewCount : 0;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "bg-surface-2 text-foreground"
                  : "text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground",
              )}
            >
              {ticketFilterLabel(f)}
              {badgeCount > 0 && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-[var(--status-ready-fg)]"
                  style={{
                    background:
                      "color-mix(in srgb, var(--status-ready-fg) 16%, transparent)",
                  }}
                >
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-surface-1 px-6 py-10 text-center text-[14px] text-[var(--text-secondary)]">
          No tickets in this view.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((t) => {
            const title = t.title ?? t.itemTitle ?? t.designType;
            const delivered = t.status === "delivered";
            const isDraft = t.status === "draft";
            const awaitingReview = needsClientReview(t.status);
            return (
              <li key={t.id}>
                <Link
                  href={
                    isDraft
                      ? `/design-request/new?draft=${t.id}`
                      : `/design-request/${t.id}`
                  }
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-xl border bg-surface-1 p-5 transition-colors hover:border-[var(--border-accent)] hover:bg-surface-2",
                    awaitingReview
                      ? "border-[var(--status-ready-fg)]"
                      : "border-[var(--border)]",
                  )}
                >
                  {/* Left region: id → title → campaign → meta */}
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-[var(--text-muted)]">
                      {formatTicketNumber(t.ticketNumber)}
                    </p>
                    <p className="mt-1 text-[15px] font-semibold text-foreground">
                      {title}
                    </p>
                    <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                      {t.campaignName
                        ? `${t.campaignName} — ${t.designType}`
                        : t.designType}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-[var(--text-muted)]">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays size={13} />{" "}
                        {isDraft ? "Saved" : "Submitted"}{" "}
                        {formatDate(t.createdAt)}
                      </span>
                      {t.dueDate && (
                        <span className="inline-flex items-center gap-1.5">
                          <Clock size={13} />
                          {delivered ? "Delivered " : "Due "}
                          {formatDate(t.dueDate)}
                        </span>
                      )}
                      {t.slides != null && (
                        <span className="inline-flex items-center gap-1.5">
                          <ImageIcon size={13} /> {t.slides} slides
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right region: thumbnail (delivered) + status badge */}
                  <div className="flex shrink-0 items-center gap-3">
                    {delivered && (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border)] bg-surface-2 text-[var(--text-muted)]">
                        <ImageIcon size={18} />
                      </div>
                    )}
                    <TicketStatusBadge status={t.status} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
