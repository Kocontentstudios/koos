import { humanizeStatus, type TicketStatus } from "@/lib/design/tickets-ui";
import { cn } from "@/lib/utils";

/** Lifecycle status colors per UI spec §5.9 (Design Ticket Lifecycle table).
 * These literal hexes are the spec source of truth, hence allowed here. */
const STATUS_COLOR: Record<TicketStatus, string> = {
  submitted: "#D4A954",
  assigned: "#85B7EB",
  in_progress: "#138BC8",
  ready_for_review: "#97C459",
  delivered: "#97C459",
  revision_requested: "#D4A954",
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
