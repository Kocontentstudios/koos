import { humanizeStatus, type TicketStatus } from "@/lib/design/tickets-ui";
import { cn } from "@/lib/utils";

/** Lifecycle status colors per UI spec §5.9 (Design Ticket Lifecycle table).
 * Mapped to the shared status tokens: these carry the spec hexes in dark mode
 * and darken for light mode so the badge text stays readable on white. */
const STATUS_COLOR: Record<TicketStatus, string> = {
  submitted: "var(--status-pending-fg)",
  assigned: "var(--status-progress-fg)",
  in_progress: "var(--primary)",
  ready_for_review: "var(--status-ready-fg)",
  delivered: "var(--status-ready-fg)",
  revision_requested: "var(--status-pending-fg)",
};

/**
 * Status badge for design tickets. Distinct from the calendar `StatusBadge`
 * (which maps calendar item statuses); this one maps the 6 ticket lifecycle
 * statuses to the spec colors.
 */
export function TicketStatusBadge({
  status,
  className,
}: {
  status: TicketStatus;
  className?: string;
}) {
  const color = STATUS_COLOR[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-[3px] text-[11px] font-medium whitespace-nowrap",
        className,
      )}
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
      }}
    >
      {humanizeStatus(status)}
    </span>
  );
}
