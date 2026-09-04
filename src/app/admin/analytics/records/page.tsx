import Link from "next/link";
import { PAGE_SIZE, pageCount } from "@/lib/admin/scope";
import { adminScopeHref, loadAdminScope } from "@/lib/admin/scope-params";
import {
  type AnalyticsFilter,
  analyticsFilterFrom,
  describeWindow,
} from "@/lib/analytics/filter";
import {
  isRecordKind,
  RECORD_DESCRIPTIONS,
  RECORD_LABELS,
  type RecordKind,
} from "@/lib/analytics/records";
import { formatDuration } from "@/lib/analytics/rollup";
import { requireRole } from "@/lib/auth/require-role";
import {
  countApprovalRecords,
  countBrandRecords,
  countGenerationRecords,
  countTicketRecords,
  countUserRecords,
  listApprovalRecords,
  listBrandRecords,
  listGenerationRecords,
  listTicketRecords,
  listUserRecords,
} from "@/lib/db/queries";
import { formatTicketNumber } from "@/lib/design/ticket";
import { humanizeStatus, type TicketStatus } from "@/lib/design/tickets-ui";
import { RecordsTable, type RecordsTableProps } from "./records-table";

const KIND_LABELS: Record<string, string> = {
  strategy_generated: "Strategy",
  calendar_generated: "Calendar",
  design_ticket_created: "Design ticket",
  design_generated: "Design image",
};

function name(
  first: string | null,
  last: string | null,
  email: string | null,
): string {
  return `${first ?? ""} ${last ?? ""}`.trim() || (email ?? "—");
}

function date(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The records behind an analytics number.
 *
 * One route for all five metrics rather than five routes: they share the
 * filter, the paging and the empty states, and the only thing that differs is
 * which columns a row has. `metric` selects that.
 */
export default async function AnalyticsRecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(["admin"]);

  const scope = loadAdminScope(await searchParams);
  const metric = isRecordKind(scope.metric) ? scope.metric : "generations";
  const now = new Date();
  const filter = analyticsFilterFrom(scope, now);
  const offset = (scope.page - 1) * PAGE_SIZE;

  const table = await buildTable(metric, filter, offset);
  const pages = pageCount(table.total, PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <Link
          href={adminScopeHref("/admin/analytics", scope, {
            metric: undefined,
          })}
          className="text-[13px] font-semibold text-primary hover:underline"
        >
          ← Back to Analytics
        </Link>
        <h1 className="font-display text-2xl font-bold text-foreground">
          {RECORD_LABELS[metric]}
        </h1>
        {/* Says what the rows ARE, so the columns make sense before they are
            read, and states the window the number came from. */}
        <p className="text-[14px] text-[var(--text-secondary)]">
          {RECORD_DESCRIPTIONS[metric]} Showing {describeWindow(filter)}.
        </p>
      </header>

      <RecordsTable
        {...table}
        page={scope.page}
        pages={pages}
        prevHref={
          scope.page > 1
            ? adminScopeHref("/admin/analytics/records", scope, {
                page: Math.min(scope.page - 1, pages),
              })
            : null
        }
        nextHref={
          scope.page < pages
            ? adminScopeHref("/admin/analytics/records", scope, {
                page: scope.page + 1,
              })
            : null
        }
      />
    </div>
  );
}

type TableData = Omit<
  RecordsTableProps,
  "page" | "pages" | "prevHref" | "nextHref"
>;

async function buildTable(
  metric: RecordKind,
  filter: AnalyticsFilter,
  offset: number,
): Promise<TableData> {
  switch (metric) {
    case "users": {
      const [rows, total] = await Promise.all([
        listUserRecords(filter, PAGE_SIZE, offset),
        countUserRecords(filter),
      ]);
      return {
        total,
        columns: ["Name", "Email", "Role", "Signed up"],
        rows: rows.map((r) => ({
          key: r.id,
          cells: [
            name(r.firstName, r.lastName, r.email),
            r.email,
            r.role,
            date(r.createdAt),
          ],
        })),
        empty: "Nobody signed up in this window.",
      };
    }
    case "brands": {
      const [rows, total] = await Promise.all([
        listBrandRecords(filter, PAGE_SIZE, offset),
        countBrandRecords(filter),
      ]);
      return {
        total,
        columns: ["Brand", "Owner", "Last active", "Activity"],
        rows: rows.map((r) => ({
          key: r.brandId,
          href: `/admin/brands/${r.brandId}`,
          cells: [
            r.name,
            name(r.ownerFirstName, r.ownerLastName, r.ownerEmail),
            date(r.lastActiveAt),
            String(r.count),
          ],
        })),
        empty: "No brand was active in this window.",
      };
    }
    case "tickets": {
      const [rows, total] = await Promise.all([
        listTicketRecords(filter, PAGE_SIZE, offset),
        countTicketRecords(filter),
      ]);
      return {
        total,
        columns: ["Ticket", "Title", "Brand", "Status", "Created"],
        rows: rows.map((r) => ({
          key: r.id,
          href: `/admin/tickets/${r.id}`,
          cells: [
            formatTicketNumber(r.ticketNumber),
            r.title ?? r.designType,
            r.brandName ?? "—",
            humanizeStatus(r.status as TicketStatus),
            date(r.createdAt),
          ],
        })),
        empty: "No ticket was created in this window.",
      };
    }
    case "approvals": {
      const [rows, total] = await Promise.all([
        listApprovalRecords(filter, PAGE_SIZE, offset),
        countApprovalRecords(filter),
      ]);
      return {
        total,
        columns: [
          "Ticket",
          "Brand",
          "Designer",
          "Requested",
          "Delivered",
          "Approved",
          "Took",
        ],
        rows: rows.map((r) => ({
          key: r.id,
          href: `/admin/tickets/${r.id}`,
          cells: [
            formatTicketNumber(r.ticketNumber),
            r.brandName ?? "—",
            name(r.designerFirstName, r.designerLastName, r.designerEmail),
            date(r.createdAt),
            date(r.deliveredAt),
            date(r.approvedAt),
            r.approvedAt
              ? formatDuration(r.approvedAt.getTime() - r.createdAt.getTime())
              : "—",
          ],
        })),
        empty: "No ticket was approved in this window.",
      };
    }
    /* `generations` explicitly, not a catch-all: falling through here is how
       `metric=tickets` rendered the generation table under a "Tickets"
       heading — the label came from RECORD_LABELS and masked it. The metric is
       validated by isRecordKind before this runs, so every kind has a case. */
    case "generations": {
      const [rows, total] = await Promise.all([
        listGenerationRecords(filter, PAGE_SIZE, offset),
        countGenerationRecords(filter),
      ]);
      return {
        total,
        columns: ["Type", "Brand", "By", "When"],
        rows: rows.map((r) => ({
          key: r.id,
          cells: [
            KIND_LABELS[r.kind] ?? r.kind,
            r.brandName ?? "—",
            name(r.userFirstName, r.userLastName, r.userEmail),
            date(r.createdAt),
          ],
        })),
        empty: "Nothing was generated in this window.",
      };
    }
  }
}
