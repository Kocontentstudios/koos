import {
  type AdminTicketView,
  lateChipFor,
  PAGE_SIZE,
  pageCount,
  VIEW_LABELS,
} from "@/lib/admin/scope";
import {
  type AdminScope,
  adminScopeHref,
  loadAdminScope,
} from "@/lib/admin/scope-params";
import { requireRole } from "@/lib/auth/require-role";
import {
  countAdminTickets,
  getStaffUsers,
  getUserById,
  getWorkloadForDesigner,
  listAdminTickets,
} from "@/lib/db/queries";
import {
  humanizeStatus,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/design/tickets-ui";
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

/**
 * How a person is named on screen.
 *
 * `first_name` is NOT NULL but may be empty, so a real user can have no
 * display name at all. Falling back to the email keeps a genuinely assigned
 * ticket from reading "Unassigned" and keeps the roster from offering a UUID
 * prefix as a person.
 */
function displayName(
  first: string | null,
  last: string | null,
  email: string | null,
): string {
  return `${first ?? ""} ${last ?? ""}`.trim() || (email ?? "");
}

/* KOS-ADMIN-FEAT-001 asks for this view "connected to the Dashboard and
   Analytics". The Dashboard half is here. The Analytics half lands with
   ADMIN-FEAT-005/003/007, which put a scope on the analytics page and make its
   cards link — there is nothing to link INTO from a page that has no filter
   state yet, so building it here would ship a link that ignores the filters it
   is supposed to carry. */
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
    /* Counted under exactly what its own tab href opens — including the
       `status: []` clear. Keeping scope.status here counted
       `revision_requested AND draft` (zero, so the badge vanished) and then
       opened the full revision list: the same count-vs-list drift these
       tickets exist to remove. */
    countAdminTickets(
      { ...scope, view: "needs_revision", status: [], page: 1 },
      { now },
    ),
    canAssign ? getStaffUsers() : Promise.resolve([]),
    workloadFor(scope.assignee, now),
  ]);

  const queue: QueueRow[] = rows.map((r) => {
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
      assigneeName: displayName(
        r.designerFirstName,
        r.designerLastName,
        r.designerEmail,
      ),
      overdueFor: lateChipFor(
        {
          status: r.status as TicketStatus,
          approvedAt: r.approvedAt,
          dueDate: r.dueDate,
        },
        now,
      ),
    };
  });

  const filters: QueueFilterLink[] = VIEWS.map(({ view, label }) => ({
    key: view,
    label,
    /* Carries the scope and patches the view — but CLEARS `status`. A status
       narrows within a view, so keeping it across a tab click produced
       `NOT IN (draft, delivered) AND = delivered`: zero rows under the message
       "The queue is empty. Nice work." while 41 open tickets existed. Brand
       and assignee are orthogonal and still ride along. */
    href: adminScopeHref("/admin/tickets", scope, {
      view,
      status: [],
      page: 1,
    }),
    active: scope.view === view,
    count: view === "needs_revision" ? revisionCount : undefined,
  }));

  const pages = pageCount(total, PAGE_SIZE);
  const statusLabels = scope.status.map(humanizeStatus);
  const staff: Assignee[] = assignees.map((u) => ({
    id: u.id,
    name: displayName(u.firstName, u.lastName, u.email),
    role: u.role,
  }));

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          Design Queue
        </h1>
        {/* Says what this list IS. `approved` and `active` have no tab, so
            without it those two drill-downs arrive as unexplained rows with
            nothing highlighted. */}
        <p className="text-[14px] text-[var(--text-secondary)]">
          {describeScope(scope, statusLabels)}
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
            ? adminScopeHref("/admin/tickets", scope, {
                // From past the end, step back to the last real page rather
                // than into another empty one.
                page: Math.min(scope.page - 1, pages),
              })
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

/** What the operator is looking at, in the words the dashboard used. */
function describeScope(scope: AdminScope, statusLabels: string[]): string {
  const parts = [VIEW_LABELS[scope.view]];
  if (statusLabels.length) parts.push(`status: ${statusLabels.join(", ")}`);
  if (scope.q) parts.push(`matching "${scope.q}"`);
  return parts.join(" · ");
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
    name: displayName(person.firstName, person.lastName, person.email),
    active: load.active,
    overdue: load.overdue,
  };
}
