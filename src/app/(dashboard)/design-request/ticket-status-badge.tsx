import { humanizeStatus, type TicketStatus } from "@/lib/design/tickets-ui";
import { cn } from "@/lib/utils";

/** Lifecycle status colors per UI spec §5.9 (Design Ticket Lifecycle table),
 * on the shared status pill tokens so each pair is the one theme-contrast.test.ts
 * holds to 4.5:1 on every surface. A 16% color-mix of the fg under itself
 * measured 3.99:1 (pending) on a white card. */
export const TICKET_STATUS_TONE: Record<
  TicketStatus,
  { fg: string; bg: string }
> = {
  draft: { fg: "var(--status-draft-fg)", bg: "var(--status-draft-bg)" },
  submitted: { fg: "var(--status-pending-fg)", bg: "var(--status-pending-bg)" },
  assigned: {
    fg: "var(--status-progress-fg)",
    bg: "var(--status-progress-bg)",
  },
  in_progress: { fg: "var(--primary-text)", bg: "var(--status-progress-bg)" },
  ready_for_review: {
    fg: "var(--status-ready-fg)",
    bg: "var(--status-ready-bg)",
  },
  delivered: { fg: "var(--status-ready-fg)", bg: "var(--status-ready-bg)" },
  revision_requested: {
    fg: "var(--status-pending-fg)",
    bg: "var(--status-pending-bg)",
  },
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
  const tone = TICKET_STATUS_TONE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-[3px] text-[11px] font-medium whitespace-nowrap",
        className,
      )}
      style={{ color: tone.fg, backgroundColor: tone.bg }}
    >
      {humanizeStatus(status)}
    </span>
  );
}
