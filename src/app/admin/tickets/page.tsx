import {
  type AdminTicketView,
  formatOverdue,
  overdueMs,
} from "@/lib/admin/scope";
import {
  type AdminScope,
  adminScopeHref,
  loadAdminScope,
} from "@/lib/admin/scope-params";
import { requireRole } from "@/lib/auth/require-role";
import { countAdminTickets, listAdminTickets } from "@/lib/db/queries";
import type { TicketPriority, TicketStatus } from "@/lib/design/tickets-ui";
import {
  QueueClient,
  type QueueFilterLink,
  type QueueRow,
} from "./queue-client";

/* The working queue plus every drill-down the dashboard links to. Views are
   named in ticket language, not enum values — see VIEW_PREDICATES, which is
   where that mapping is defined and tested. */
const VIEWS: { view: AdminTicketView; label: string }[] = [
  { view: "open", label: "Open" },
  { view: "in_progress", label: "In progress" },
  { view: "needs_revision", label: "Needs revision" },
  { view: "awaiting_review", label: "Awaiting review" },
  { view: "overdue", label: "Overdue" },
  { view: "all", label: "All" },
];

const EMPTY_FOR: Partial<Record<AdminTicketView, string>> = {
  open: "The queue is empty. Nice work.",
  overdue: "Nothing is overdue.",
  needs_revision: "No revisions requested.",
  awaiting_review: "Nothing is waiting on a client.",
};

export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(["designer", "admin"]);

  /* Parsed server-side so a shared link renders correctly on a cold load, and
     so the filtering, sorting and paging happen in SQL rather than over the
     rows that happen to be on screen. */
  const scope = loadAdminScope(await searchParams);
  const effective: AdminScope =
    scope.view === "all" && !scope.status.length && !scope.assignee
      ? { ...scope, view: "open" }
      : scope;

  const now = new Date();
  const [rows, total] = await Promise.all([
    listAdminTickets(effective, { now }),
    countAdminTickets(effective, { now }),
  ]);

  const queue: QueueRow[] = rows.map((r) => {
    const late = overdueMs(r.dueDate, now);
    return {
      id: r.id,
      ticketNumber: r.ticketNumber,
      designType: r.designType,
      dimensions: null,
      slides: null,
      brief: "",
      status: r.status as TicketStatus,
      priority: r.priority as TicketPriority,
      brandName: r.brandName ?? null,
      campaignName: null,
      itemTitle: null,
      title: r.title ?? null,
      dueDate: r.dueDate ? r.dueDate.toISOString() : null,
      assigneeName:
        `${r.designerFirstName ?? ""} ${r.designerLastName ?? ""}`.trim() || "",
      overdueFor: late === null ? null : formatOverdue(late),
    };
  });

  const filters: QueueFilterLink[] = VIEWS.map(({ view, label }) => ({
    key: view,
    label,
    // Carries the whole scope and patches one key, so a view change never
    // silently drops a brand or assignee filter the user applied.
    href: adminScopeHref("/admin/tickets", scope, { view, page: 1 }),
    active: effective.view === view,
  }));

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          Design Queue
        </h1>
        <p className="text-[14px] text-[var(--text-secondary)]">
          Every ticket the studio is carrying, and everything the dashboard
          links to.
        </p>
      </header>

      <QueueClient
        queue={queue}
        filters={filters}
        total={total}
        emptyMessage={EMPTY_FOR[effective.view] ?? "No tickets in this view."}
      />
    </div>
  );
}
