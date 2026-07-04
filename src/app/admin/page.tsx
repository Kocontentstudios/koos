import Link from "next/link";
import { TicketStatusBadge } from "@/app/(dashboard)/design-request/ticket-status-badge";
import { requireRole } from "@/lib/auth/require-role";
import {
  getDesignerLoads,
  getOverdueTicketCount,
  getRecentTickets,
  getTicketCountsByStatus,
  getUserCountsByRole,
} from "@/lib/db/queries";
import { formatTicketNumber } from "@/lib/design/ticket";
import type { TicketStatus } from "@/lib/design/tickets-ui";

const OPEN_STATUSES = new Set<string>([
  "submitted",
  "assigned",
  "in_progress",
  "ready_for_review",
  "revision_requested",
]);

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-1 p-4">
      <p className="text-[12px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-bold text-foreground">
        {value}
      </p>
    </div>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function AdminDashboardPage() {
  await requireRole(["designer", "admin"]);

  const [byStatus, overdue, byRole, loads, recent] = await Promise.all([
    getTicketCountsByStatus(),
    getOverdueTicketCount(),
    getUserCountsByRole(),
    getDesignerLoads(),
    getRecentTickets(8),
  ]);

  const statusMap = new Map(byStatus.map((r) => [r.status, r.count]));
  const openCount = byStatus
    .filter((r) => OPEN_STATUSES.has(r.status))
    .reduce((sum, r) => sum + r.count, 0);
  const readyCount = statusMap.get("ready_for_review") ?? 0;
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
        <StatCard label="Open tickets" value={openCount} />
        <StatCard label="Overdue" value={overdue} />
        <StatCard label="Ready for review" value={readyCount} />
        <StatCard label="Delivered" value={deliveredCount} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-[15px] font-semibold text-foreground">
            Tickets by status
          </h2>
          <ul className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-surface-1 p-4">
            {byStatus.length === 0 ? (
              <li className="text-[13px] text-[var(--text-secondary)]">
                No tickets yet.
              </li>
            ) : (
              byStatus.map((r) => (
                <li
                  key={r.status}
                  className="flex items-center justify-between gap-3"
                >
                  <TicketStatusBadge status={r.status as TicketStatus} />
                  <span className="text-[14px] font-medium text-foreground">
                    {r.count}
                  </span>
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
                <li
                  key={l.designerId ?? "unassigned"}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="text-[14px] text-foreground">
                    {`${l.firstName ?? ""} ${l.lastName ?? ""}`.trim() ||
                      "Unknown"}
                  </span>
                  <span className="text-[14px] font-medium text-foreground">
                    {l.count} active
                  </span>
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
