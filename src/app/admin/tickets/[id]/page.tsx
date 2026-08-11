import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TicketStatusBadge } from "@/app/(dashboard)/design-request/ticket-status-badge";
import {
  TicketUpdatesTimeline,
  type TimelineUpdate,
} from "@/app/(dashboard)/design-request/ticket-updates-timeline";
import { AnnotationOverlay } from "@/components/design/annotation-overlay";
import { TicketRequestDetails } from "@/components/design/ticket-request-details";
import { Markdown } from "@/components/ui/markdown";
import { requireRole } from "@/lib/auth/require-role";
import {
  type AnnotationShape,
  getAnnotationsForTicket,
  getBrandById,
  getDeliverables,
  getDesignTicketById,
  getStaffUsers,
  getTicketUpdates,
} from "@/lib/db/queries";
import {
  formatTicketNumber,
  groupDeliverablesByVersion,
  latestVersion,
} from "@/lib/design/ticket";
import type { TicketStatus } from "@/lib/design/tickets-ui";
import { ManagePanel, type StaffOption } from "./manage-panel";
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
  const { dbUser } = await requireRole(["designer", "admin"]);
  const isAdmin = dbUser.role === "admin";
  const { id } = await params;
  const ticket = await getDesignTicketById(id);
  if (!ticket) notFound();

  const [brand, deliverables, updateRows, staff, annotationRows] =
    await Promise.all([
      getBrandById(ticket.brandId),
      getDeliverables(ticket.id),
      getTicketUpdates(ticket.id),
      getStaffUsers(),
      getAnnotationsForTicket(ticket.id),
    ]);

  const annotationsByDeliverable = new Map<
    string,
    { shapes: AnnotationShape[]; note: string | null }[]
  >();
  for (const row of annotationRows) {
    const existing = annotationsByDeliverable.get(row.deliverableId) ?? [];
    existing.push({ shapes: row.shapes, note: row.note });
    annotationsByDeliverable.set(row.deliverableId, existing);
  }

  // Feedback is grouped per delivery round so addressed rounds don't read as
  // outstanding work sitting next to the current round's notes.
  const currentVersion = latestVersion(deliverables);
  const annotatedRounds = groupDeliverablesByVersion(
    deliverables.filter((d) => annotationsByDeliverable.has(d.id)),
  );

  const updates: TimelineUpdate[] = updateRows.map((r) => ({
    id: r.update.id,
    message: r.update.message,
    newStatus: r.update.newStatus,
    createdAt: r.update.createdAt,
    authorName:
      `${r.authorFirstName ?? ""} ${r.authorLastName ?? ""}`.trim() ||
      (r.authorRole === "user" ? "Client" : "Staff"),
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
            {ticket.title
              ? `${formatTicketNumber(ticket.ticketNumber)} — ${ticket.title}`
              : formatTicketNumber(ticket.ticketNumber)}
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
          <Markdown className="text-sm text-[var(--text-secondary)]">
            {ticket.brief}
          </Markdown>
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
          {ticket.priority !== "normal" ? ` · ${ticket.priority} priority` : ""}
        </p>
      </section>

      <TicketRequestDetails ticketId={ticket.id} specs={ticket.specs} />

      {annotatedRounds.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-[15px] font-semibold text-foreground">
            Reviewer annotations
          </h2>
          {annotatedRounds.map((round) => {
            const addressed = round.version !== currentVersion;
            const files = round.items.map((d) => {
              const marks = annotationsByDeliverable.get(d.id) ?? [];
              return {
                id: d.id,
                fileName: d.fileName,
                shapes: marks.flatMap((m) => m.shapes),
                notes: marks
                  .map((m) => m.note)
                  .filter((note): note is string => Boolean(note?.trim())),
              };
            });
            return (
              <details
                key={round.version}
                open={!addressed}
                className="rounded-xl border border-[var(--border)] bg-surface-1 p-4"
              >
                <summary className="cursor-pointer text-[13px] font-semibold text-foreground">
                  Round {round.version} feedback
                  {addressed && (
                    <span className="ml-2 font-normal text-[var(--text-muted)]">
                      — addressed in v{currentVersion}
                    </span>
                  )}
                </summary>
                <div className="mt-3 space-y-4">
                  {files.map((f) => (
                    <div key={f.id} className="space-y-2">
                      <p className="text-[13px] font-medium text-[var(--text-secondary)]">
                        {f.fileName}
                      </p>
                      <AnnotationOverlay
                        imageUrl={`/api/design-tickets/${ticket.id}/deliverables/${f.id}?disposition=inline`}
                        shapes={f.shapes}
                      />
                      {f.notes.length > 0 && (
                        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
                          {f.notes.map((note, index) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: notes are a static, read-only snapshot with no stable id
                            <li key={index}>{note}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </section>
      )}

      {isAdmin && (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold text-foreground">Manage</h2>
          <ManagePanel
            ticketId={ticket.id}
            currentStatus={ticket.status}
            currentPriority={ticket.priority}
            currentAssigneeId={ticket.assignedDesignerId}
            staff={staff.map<StaffOption>((s) => ({
              id: s.id,
              name: `${s.firstName} ${s.lastName}`.trim(),
            }))}
          />
        </section>
      )}

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
