import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnnotationRounds } from "@/components/design/annotation-rounds";
import { TicketRequestDetails } from "@/components/design/ticket-request-details";
import { Markdown } from "@/components/ui/markdown";
import { requireBrand } from "@/lib/auth/require-brand";
import { can } from "@/lib/auth/workspace-access";
import {
  checkBrandAccess,
  getAnnotationsForTicket,
  getDeliverables,
  getDesignTicketById,
  getTicketUpdates,
} from "@/lib/db/queries";
import {
  formatTicketNumber,
  groupDeliverablesByVersion,
} from "@/lib/design/ticket";
import type { TicketStatus } from "@/lib/design/tickets-ui";
import { TicketStatusBadge } from "../ticket-status-badge";
import {
  TicketUpdatesTimeline,
  type TimelineUpdate,
} from "../ticket-updates-timeline";
import { CommentComposer } from "./comment-composer";
import { DeliverableVersions } from "./deliverable-versions";
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
  const { dbUser, role } = await requireBrand();
  const ticket = await getDesignTicketById(id);

  if (!ticket) {
    notFound();
  }

  const access = await checkBrandAccess(
    dbUser.id,
    ticket.brandId,
    "manage_content",
  );
  if (!access.ok) notFound();

  const isStaff = dbUser.role === "designer" || dbUser.role === "admin";
  const deliverables = await getDeliverables(ticket.id);
  const versions = groupDeliverablesByVersion(deliverables);
  const latest = versions[0] ?? null;
  const [updateRows, annotationRows] = await Promise.all([
    getTicketUpdates(ticket.id),
    getAnnotationsForTicket(ticket.id),
  ]);
  // Staff stay pseudonymous behind one team name; the client's own entries are
  // attributed back to them so a revision request doesn't read as studio output.
  const updates: TimelineUpdate[] = updateRows.map((r) => ({
    id: r.update.id,
    message: r.update.message,
    newStatus: r.update.newStatus,
    createdAt: r.update.createdAt,
    authorName:
      r.update.authorId === dbUser.id
        ? "You"
        : r.authorRole === "designer" || r.authorRole === "admin"
          ? "KO Design Team"
          : `${r.authorFirstName ?? ""} ${r.authorLastName ?? ""}`.trim() ||
            "Client",
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
            {ticket.title
              ? `${formatTicketNumber(ticket.ticketNumber)} — ${ticket.title}`
              : formatTicketNumber(ticket.ticketNumber)}
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
          <Markdown className="text-sm">{ticket.brief}</Markdown>
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

      <TicketRequestDetails ticketId={ticket.id} specs={ticket.specs} />

      <DeliverableVersions
        ticketId={ticket.id}
        groups={versions}
        canDownload={ticket.approvedAt !== null || isStaff}
      />

      {/* The client drew these during a review but could only ever see them on
          the admin page, so their own markup was invisible to them. */}
      <AnnotationRounds
        ticketId={ticket.id}
        deliverables={deliverables}
        annotations={annotationRows}
        currentVersion={latest?.version ?? null}
        title="Your markup"
      />

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-foreground">Updates</h2>
        <TicketUpdatesTimeline updates={updates} />
        {/* Commenting is not gated on status: the review actions only appear
            while a design awaits review, which left the client unable to say
            anything during the work or after approving. */}
        <CommentComposer ticketId={ticket.id} />
      </section>

      {status === "ready_for_review" && latest && (
        <ReviewActions
          canApprove={can(role, "approve_deliverables")}
          ticketId={ticket.id}
          version={latest.version}
          deliverables={latest.items
            .filter((d) => IMAGE_RE.test(d.fileName))
            .map((d) => ({
              id: d.id,
              fileName: d.fileName,
              url: `/api/design-tickets/${ticket.id}/deliverables/${d.id}?disposition=inline`,
            }))}
        />
      )}
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
