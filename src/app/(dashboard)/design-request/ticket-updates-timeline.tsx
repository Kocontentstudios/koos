import { humanizeStatus, type TicketStatus } from "@/lib/design/tickets-ui";

export interface TimelineUpdate {
  id: string;
  message: string;
  newStatus: string | null;
  createdAt: Date;
  authorName: string;
}

function formatWhen(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function TicketUpdatesTimeline({
  updates,
}: {
  updates: TimelineUpdate[];
}) {
  if (updates.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border)] bg-surface-1 px-4 py-6 text-center text-[13px] text-[var(--text-secondary)]">
        No updates yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {updates.map((u) => (
        <li
          key={u.id}
          className="rounded-xl border border-[var(--border)] bg-surface-1 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-foreground">
              {u.authorName}
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              {formatWhen(u.createdAt)}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-[var(--text-secondary)]">
            {u.message}
          </p>
          {u.newStatus && (
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Status → {humanizeStatus(u.newStatus as TicketStatus)}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
