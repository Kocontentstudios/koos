import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TicketStatusBadge } from "@/app/(dashboard)/design-request/ticket-status-badge";
import {
  TicketUpdatesTimeline,
  type TimelineUpdate,
} from "@/app/(dashboard)/design-request/ticket-updates-timeline";
import { requireRole } from "@/lib/auth/require-role";
import {
  getBrandById,
  getDeliverables,
  getDesignTicketById,
  getTicketUpdates,
} from "@/lib/db/queries";
import { formatTicketNumber } from "@/lib/design/ticket";
import type { TicketStatus } from "@/lib/design/tickets-ui";
import { UpdateComposer } from "./update-composer";

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function AdminTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["designer", "admin"]);
  const { id } = await params;
  const ticket = await getDesignTicketById(id);
  if (!ticket) notFound();

  const [brand, deliverables, updateRows] = await Promise.all([
    getBrandById(ticket.brandId),
    getDeliverables(ticket.id),
    getTicketUpdates(ticket.id),
  ]);

  const updates: TimelineUpdate[] = updateRows.map((r) => ({
    id: r.update.id,
    message: r.update.message,
    newStatus: r.update.newStatus,
    createdAt: r.update.createdAt,
    authorName:
      `${r.authorFirstName ?? ""} ${r.authorLastName ?? ""}`.trim() || "Staff",
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link
        href="/admin/tickets"
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)] hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Queue
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-foreground">
            {formatTicketNumber(ticket.ticketNumber)}
          </h1>
          <p className="text-[15px] text-[var(--text-secondary)]">
            {ticket.designType}
            {ticket.dimensions ? ` · ${ticket.dimensions}` : ""}
            {brand?.name ? ` · ${brand.name}` : ""}
          </p>
        </div>
        <TicketStatusBadge status={ticket.status as TicketStatus} />
      </header>

      <section className="grid gap-4 rounded-xl border border-[var(--border)] bg-surface-1 p-5">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Brief
          </p>
          <p className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
            {ticket.brief}
          </p>
        </div>
        {ticket.notes && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Notes
            </p>
            <p className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
              {ticket.notes}
            </p>
          </div>
        )}
        <p className="text-[13px] text-[var(--text-muted)]">
          Due {formatDate(ticket.dueDate)} · {deliverables.length} deliverable
          {deliverables.length === 1 ? "" : "s"}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-foreground">
          Post an update
        </h2>
        <UpdateComposer ticketId={ticket.id} />
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-foreground">Updates</h2>
        <TicketUpdatesTimeline updates={updates} />
      </section>
    </div>
  );
}
