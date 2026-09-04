import {
  type AdminTicketView,
  deliveredDateOf,
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
import { countAdminTickets, listDeliveredProjects } from "@/lib/db/queries";
import { humanizeStatus, type TicketStatus } from "@/lib/design/tickets-ui";
import {
  DeliveredClient,
  type DeliveredFilter,
  type DeliveredRow,
} from "./delivered-client";

/**
 * Where completed work is findable again.
 *
 * Delivered and approved tickets leave the queue, so the dashboard's two
 * status rows for those states point here rather than at a filtered queue —
 * see statusRowHref.
 */

/* No separate "Completed" chip. The ticket lists it alongside Approved, but
   this data model has one signed-off state (`delivered`, which the UI labels
   "Approved") and no distinct completed one. Two chips returning byte-identical
   lists would be worse than one honest chip, so Approved covers both and the
   label says so. */
const FILTERS: { view: AdminTicketView; label: string }[] = [
  { view: "delivered", label: "All delivered" },
  { view: "awaiting_review", label: "Awaiting review" },
  { view: "approved", label: "Approved / completed" },
];

const EMPTY_FOR: Partial<Record<AdminTicketView, string>> = {
  delivered: "Nothing has been delivered yet.",
  awaiting_review: "Nothing is waiting on a client.",
  approved: "No work has been signed off yet.",
};

function displayName(
  first: string | null,
  last: string | null,
  email: string | null,
): string {
  return `${first ?? ""} ${last ?? ""}`.trim() || (email ?? "");
}

function formatDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function AdminDeliveredPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(["designer", "admin"]);

  const raw = loadAdminScope(await searchParams);
  /* This page is only ever about delivered work. An arriving scope that names
     a queue view (or none) is read as the page's own default rather than
     showing an unrelated list under a Delivered Projects heading. */
  const view: AdminTicketView = FILTERS.some((f) => f.view === raw.view)
    ? raw.view
    : "delivered";
  const scope: AdminScope = { ...raw, view };

  const now = new Date();
  const [rows, total] = await Promise.all([
    listDeliveredProjects(scope, { now }),
    countAdminTickets(scope, { now }),
  ]);

  const projects: DeliveredRow[] = rows.map((r) => ({
    id: r.id,
    ticketNumber: r.ticketNumber,
    title: r.title ?? r.designType,
    brandName: r.brandName ?? null,
    requesterName: displayName(
      r.requesterFirstName,
      r.requesterLastName,
      r.requesterEmail,
    ),
    designerName: displayName(
      r.designerFirstName,
      r.designerLastName,
      r.designerEmail,
    ),
    deliveredOn: formatDate(deliveredDateOf(r)),
    approvedOn: formatDate(r.approvedAt),
    status: r.status as TicketStatus,
  }));

  const filters: DeliveredFilter[] = FILTERS.map(({ view: v, label }) => ({
    key: v,
    label,
    // Carries the scope and clears `status`, for the reason the queue's tabs do:
    // a status narrows WITHIN a view, so keeping it can yield an empty AND.
    href: adminScopeHref("/admin/delivered", scope, {
      view: v,
      status: [],
      page: 1,
    }),
    active: view === v,
  }));

  const pages = pageCount(total, PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          Delivered Projects
        </h1>
        <p className="text-[14px] text-[var(--text-secondary)]">
          {describeScope(scope, scope.status.map(humanizeStatus))}
        </p>
      </header>

      <DeliveredClient
        rows={projects}
        filters={filters}
        total={total}
        page={scope.page}
        pages={pages}
        prevHref={
          scope.page > 1
            ? adminScopeHref("/admin/delivered", scope, {
                page: Math.min(scope.page - 1, pages),
              })
            : null
        }
        nextHref={
          scope.page < pages
            ? adminScopeHref("/admin/delivered", scope, {
                page: scope.page + 1,
              })
            : null
        }
        emptyMessage={emptyMessageFor(scope, pages, total)}
      />
    </div>
  );
}

/** Whether anything beyond the view is narrowing the list. */
function isNarrowed(scope: AdminScope): boolean {
  return Boolean(
    scope.status.length ||
      scope.assignee ||
      scope.brand ||
      scope.requester ||
      scope.range !== "all",
  );
}

/* An empty narrowed list is a statement about the filter, never about how much
   work the studio has delivered. */
function emptyMessageFor(
  scope: AdminScope,
  pages: number,
  total: number,
): string {
  if (scope.page > pages && total > 0) {
    return `Page ${scope.page} is past the end of this list.`;
  }
  if (scope.q.trim()) return `Nothing matches "${scope.q.trim()}".`;
  if (isNarrowed(scope)) return "Nothing matches these filters.";
  return EMPTY_FOR[scope.view] ?? "Nothing here yet.";
}

function describeScope(scope: AdminScope, statusLabels: string[]): string {
  const parts = [VIEW_LABELS[scope.view]];
  if (statusLabels.length) parts.push(`status: ${statusLabels.join(", ")}`);
  if (scope.assignee) parts.push("one designer");
  if (scope.brand) parts.push("one brand");
  if (scope.requester) parts.push("one requester");
  if (scope.range !== "all") parts.push(`last ${scope.range}`);
  if (scope.q) parts.push(`matching "${scope.q}"`);
  return parts.join(" · ");
}
