import Link from "next/link";
import { TicketStatusBadge } from "@/app/(dashboard)/design-request/ticket-status-badge";
import { StatCard } from "@/app/admin/stat-card";
import { statusRowHref } from "@/lib/admin/scope";
import { adminScopeHref, DEFAULT_SCOPE } from "@/lib/admin/scope-params";
import { requireRole } from "@/lib/auth/require-role";
import {
  getAwaitingReviewCount,
  getDesignerLoads,
  getOpenTicketCount,
  getOverdueTicketCount,
  getRecentTickets,
  getTicketCountsByStatus,
  getUserCountsByRole,
} from "@/lib/db/queries";
import { formatTicketNumber } from "@/lib/design/ticket";
import type { TicketStatus } from "@/lib/design/tickets-ui";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function AdminDashboardPage() {
  await requireRole(["designer", "admin"]);

  /* Each card resolves the SAME predicate as the list it opens, rather than
     summing the status rollup to something that looks close. A card whose
     number disagrees with its own drill-down is the bug this ticket exists to
     fix, so the agreement is structural, not arithmetic. */
  const [byStatus, openCount, overdue, readyCount, byRole, loads, recent] =
    await Promise.all([
      getTicketCountsByStatus(),
      getOpenTicketCount(),
      getOverdueTicketCount(),
      getAwaitingReviewCount(),
      getUserCountsByRole(),
      getDesignerLoads(),
      getRecentTickets(8),
    ]);

  const statusMap = new Map(byStatus.map((r) => [r.status, r.count]));
  // `approved` is statusIn:["delivered"], so the rollup row is already exact.
  const deliveredCount = statusMap.get("delivered") ?? 0;
  const totalUsers = byRole.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          Dashboard
        </h1>
        <p className="text-[14px] text-[var(--text-secondary)]">
          Operational overview of the design pipeline.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Open tickets"
          value={openCount}
          href={adminScopeHref("/admin/tickets", DEFAULT_SCOPE, {
            view: "open",
          })}
        />
        <StatCard
          label="Overdue"
          value={overdue}
          href={adminScopeHref("/admin/tickets", DEFAULT_SCOPE, {
            view: "overdue",
            sort: "overdue:desc",
          })}
        />
        <StatCard
          label="Ready for review"
          value={readyCount}
          href={adminScopeHref("/admin/tickets", DEFAULT_SCOPE, {
            view: "awaiting_review",
          })}
        />
        <StatCard
          label="Delivered"
          value={deliveredCount}
          href={adminScopeHref("/admin/tickets", DEFAULT_SCOPE, {
            view: "approved",
          })}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-[15px] font-semibold text-foreground">
            Dashboard Status Overview (Tickets by Status)
          </h2>
          <ul className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-surface-1 p-4">
            {byStatus.length === 0 ? (
              <li className="text-[13px] text-[var(--text-secondary)]">
                No tickets yet.
              </li>
            ) : (
              byStatus.map((r) => (
                <li key={r.status}>
                  <Link
                    href={statusRowHref(r.status as TicketStatus)}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-[var(--hover)]"
                  >
                    <TicketStatusBadge status={r.status as TicketStatus} />
                    <span className="text-[14px] font-medium text-foreground">
                      {r.count}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="space-y-3">
          <h2 className="text-[15px] font-semibold text-foreground">
            Designer load
          </h2>
          <ul className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-surface-1 p-4">
            {loads.length === 0 ? (
              <li className="text-[13px] text-[var(--text-secondary)]">
                No active assignments.
              </li>
            ) : (
              loads.map((l) => (
                <li key={l.designerId}>
                  <Link
                    href={adminScopeHref("/admin/tickets", DEFAULT_SCOPE, {
                      view: "active",
                      assignee: l.designerId,
                    })}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-[var(--hover)]"
                  >
                    <span className="text-[14px] text-foreground">
                      {`${l.firstName ?? ""} ${l.lastName ?? ""}`.trim() ||
                        "Unknown"}
                    </span>
                    <span className="text-[14px] font-medium text-foreground">
                      {l.count} active
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
          <p className="text-[13px] text-[var(--text-muted)]">
            {totalUsers} user{totalUsers === 1 ? "" : "s"} ·{" "}
            {byRole.map((r) => `${r.count} ${r.role}`).join(" · ")}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-foreground">
          Recent tickets
        </h2>
        <ul className="flex flex-col gap-2">
          {recent.length === 0 ? (
            <li className="rounded-xl border border-[var(--border)] bg-surface-1 px-4 py-6 text-center text-[13px] text-[var(--text-secondary)]">
              No tickets yet.
            </li>
          ) : (
            recent.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/admin/tickets/${t.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-3 hover:border-primary"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {formatTicketNumber(t.ticketNumber)}
                    </span>
                    <span className="text-[14px] text-foreground">
                      {t.designType}
                    </span>
                    <span className="text-[13px] text-[var(--text-secondary)]">
                      {t.brandName ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <TicketStatusBadge status={t.status as TicketStatus} />
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {formatDate(t.createdAt)}
                    </span>
                  </div>
                </Link>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
