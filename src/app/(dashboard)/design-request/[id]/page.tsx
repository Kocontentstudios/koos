import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBrand } from "@/lib/auth/require-brand";
import {
  getDeliverables,
  getDesignTicketById,
  getTicketUpdates,
} from "@/lib/db/queries";
import { formatTicketNumber } from "@/lib/design/ticket";
import type { TicketStatus } from "@/lib/design/tickets-ui";
import { TicketStatusBadge } from "../ticket-status-badge";
import {
  TicketUpdatesTimeline,
  type TimelineUpdate,
} from "../ticket-updates-timeline";
import { ReviewActions } from "./review-actions";

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { dbUser } = await requireBrand();
  const ticket = await getDesignTicketById(id);

  if (!ticket || ticket.userId !== dbUser.id) {
    notFound();
  }

  const deliverables = await getDeliverables(ticket.id);
  const updateRows = await getTicketUpdates(ticket.id);
  const updates: TimelineUpdate[] = updateRows.map((r) => ({
    id: r.update.id,
    message: r.update.message,
    newStatus: r.update.newStatus,
    createdAt: r.update.createdAt,
    authorName: "KO Design Team",
  }));
  const status = ticket.status as TicketStatus;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link
        href="/design-request"
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)] hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Design Tickets
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-foreground">
            {formatTicketNumber(ticket.ticketNumber)}
          </h1>
          <p className="text-[15px] text-[var(--text-secondary)]">
            {ticket.designType}
            {ticket.dimensions ? ` · ${ticket.dimensions}` : ""}
            {ticket.slides ? ` · ${ticket.slides} slides` : ""}
          </p>
        </div>
        <TicketStatusBadge status={status} />
      </header>

      <section className="grid gap-4 rounded-xl border border-[var(--border)] bg-surface-1 p-5 sm:grid-cols-2">
        <Detail label="Brief" full>
          <p className="whitespace-pre-wrap">{ticket.brief}</p>
        </Detail>
        {ticket.notes && (
          <Detail label="Notes" full>
            <p className="whitespace-pre-wrap">{ticket.notes}</p>
          </Detail>
        )}
        <Detail label="Due date">{formatDate(ticket.dueDate)}</Detail>
        <Detail label="Submitted">{formatDate(ticket.createdAt)}</Detail>
        <Detail label="Last updated">{formatDate(ticket.updatedAt)}</Detail>
      </section>

      {deliverables.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-foreground">
              Deliverables
            </h2>
            <a
              href={`/api/design-tickets/${ticket.id}/deliverables/zip`}
              className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              Download all (ZIP)
            </a>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {deliverables.map((d) => {
              const href = `/api/design-tickets/${ticket.id}/deliverables/${d.id}`;
              const isImage = IMAGE_RE.test(d.fileName);
              return (
                <li
                  key={d.id}
                  className="overflow-hidden rounded-xl border border-[var(--border)] bg-surface-1"
                >
                  {isImage && (
                    // biome-ignore lint/performance/noImgElement: src is a redirecting download route, not optimizable by next/image
                    <img
                      src={href}
                      alt={d.fileName}
                      className="h-40 w-full bg-surface-2 object-contain"
                    />
                  )}
                  <div className="flex items-center justify-between gap-2 p-3">
                    <span className="truncate text-[13px] text-[var(--text-secondary)]">
                      {d.fileName}
                    </span>
                    <a
                      href={href}
                      download
                      className="shrink-0 text-[13px] font-medium text-primary hover:underline"
                    >
                      Download
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-foreground">Updates</h2>
        <TicketUpdatesTimeline updates={updates} />
      </section>

      {status === "ready_for_review" && <ReviewActions ticketId={ticket.id} />}
    </div>
  );
}

function Detail({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={`space-y-1 ${full ? "sm:col-span-2" : ""}`}>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
        {children}
      </div>
    </div>
  );
}
