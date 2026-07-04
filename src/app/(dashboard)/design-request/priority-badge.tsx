import { humanizePriority, type TicketPriority } from "@/lib/design/tickets-ui";

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  if (priority === "normal") return null;
  const cls =
    priority === "urgent"
      ? "text-[var(--status-error-fg)]"
      : priority === "high"
        ? "text-foreground"
        : "text-[var(--text-muted)]";
  return (
    <span
      className={`text-[11px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {humanizePriority(priority)}
    </span>
  );
}
