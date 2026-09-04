import {
  type AdminTicketView,
  formatOverdue,
  overdueMs,
  PAGE_SIZE,
  pageCount,
} from "@/lib/admin/scope";
import { adminScopeHref, loadAdminScope } from "@/lib/admin/scope-params";
import { requireRole } from "@/lib/auth/require-role";
import {
  countAdminTickets,
  getStaffUsers,
  getUserById,
  getWorkloadForDesigner,
  listAdminTickets,
} from "@/lib/db/queries";
import type { TicketPriority, TicketStatus } from "@/lib/design/tickets-ui";
import {
  type Assignee,
  QueueClient,
  type QueueFilterLink,
  type QueueRow,
  type WorkloadHeader,
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

function fullName(first: string | null, last: string | null): string {
  return `${first ?? ""} ${last ?? ""}`.trim();
}

export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dbUser } = await requireRole(["designer", "admin"]);

  /* Parsed server-side so a shared link renders correctly on a cold load, and
     so the filtering, sorting and paging happen in SQL rather than over the
     rows that happen to be on screen. */
  const scope = loadAdminScope(await searchParams);

  /* Reassignment is an admin power — /manage refuses it for a designer — so the
     control is only offered to someone who can actually complete it. */
  const canAssign = dbUser.role === "admin";

  const now = new Date();
  const [rows, total, revisionCount, assignees, workload] = await Promise.all([
    listAdminTickets(scope, { now }),
    countAdminTickets(scope, { now }),
    // Counted under the CURRENT scope, so the badge matches the list its tab
    // opens rather than a global figure the click then contradicts.
    countAdminTickets({ ...scope, view: "needs_revision", page: 1 }, { now }),
    canAssign ? getStaffUsers() : Promise.resolve([]),
    workloadFor(scope.assignee, now),
  ]);

  const queue: QueueRow[] = rows.map((r) => {
    const late = overdueMs(r.dueDate, now);
    return {
      id: r.id,
      ticketNumber: r.ticketNumber,
      designType: r.designType,
      dimensions: r.dimensions,
      slides: r.slides,
      brief: r.brief,
      status: r.status as TicketStatus,
      priority: r.priority as TicketPriority,
      brandName: r.brandName ?? null,
      campaignName: r.campaignName ?? null,
      itemTitle: r.itemTitle ?? null,
      title: r.title ?? null,
      dueDate: r.dueDate ? r.dueDate.toISOString() : null,
      designerId: r.designerId ?? null,
      assigneeName: fullName(r.designerFirstName, r.designerLastName),
      overdueFor: late === null ? null : formatOverdue(late),
    };
  });

  const filters: QueueFilterLink[] = VIEWS.map(({ view, label }) => ({
    key: view,
    label,
    // Carries the whole scope and patches one key, so a view change never
    // silently drops a brand or assignee filter the user applied.
    href: adminScopeHref("/admin/tickets", scope, { view, page: 1 }),
    active: scope.view === view,
    count: view === "needs_revision" ? revisionCount : undefined,
  }));

  const pages = pageCount(total, PAGE_SIZE);
  const staff: Assignee[] = assignees.map((u) => ({
    id: u.id,
    name: fullName(u.firstName, u.lastName) || u.id.slice(0, 8),
    role: u.role,
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
        page={scope.page}
        pages={pages}
        prevHref={
          scope.page > 1
            ? adminScopeHref("/admin/tickets", scope, { page: scope.page - 1 })
            : null
        }
        nextHref={
          scope.page < pages
            ? adminScopeHref("/admin/tickets", scope, { page: scope.page + 1 })
            : null
        }
        workload={workload}
        assignees={staff}
        canAssign={canAssign}
        emptyMessage={
          scope.page > pages && total > 0
            ? `Page ${scope.page} is past the end of this list.`
            : (EMPTY_FOR[scope.view] ?? "No tickets in this view.")
        }
      />
    </div>
  );
}

/**
 * The "and workload" half of the designer drill-down.
 *
 * Without it the list answers "what is this person carrying" but never says
 * whose list it is, which is the difference between a filtered table and the
 * drill-down the ticket asks for.
 */
async function workloadFor(
  assignee: string,
  now: Date,
): Promise<WorkloadHeader | null> {
  if (!assignee || assignee === "unassigned") return null;
  const [person, load] = await Promise.all([
    getUserById(assignee),
    getWorkloadForDesigner(assignee, now),
  ]);
  if (!person) return null;
  return {
    name: fullName(person.firstName, person.lastName) || person.email,
    active: load.active,
    overdue: load.overdue,
  };
}
