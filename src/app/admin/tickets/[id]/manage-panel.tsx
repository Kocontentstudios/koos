"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { humanizePriority, humanizeStatus } from "@/lib/design/tickets-ui";

const STATUSES = [
  "submitted",
  "assigned",
  "in_progress",
  "ready_for_review",
  "delivered",
  "revision_requested",
] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export interface StaffOption {
  id: string;
  name: string;
}

export function ManagePanel({
  ticketId,
  currentStatus,
  currentPriority,
  currentAssigneeId,
  staff,
}: {
  ticketId: string;
  currentStatus: string;
  currentPriority: string;
  currentAssigneeId: string | null;
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [priority, setPriority] = useState(currentPriority);
  const [assignee, setAssignee] = useState(currentAssigneeId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/manage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          priority,
          assignedDesignerId: assignee || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        const msg = data?.error ?? "Could not update the ticket.";
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("Ticket updated");
      router.refresh();
    } catch {
      const msg = "Network error. Please try again.";
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  const selectCls =
    "h-9 rounded-lg border border-[var(--border)] bg-surface-1 px-2 text-[13px] text-foreground";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
          Status
          <select
            value={status}
            disabled={pending}
            onChange={(e) => setStatus(e.target.value)}
            className={selectCls}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanizeStatus(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
          Priority
          <select
            value={priority}
            disabled={pending}
            onChange={(e) => setPriority(e.target.value)}
            className={selectCls}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {humanizePriority(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
          Assignee
          <select
            value={assignee}
            disabled={pending}
            onChange={(e) => setAssignee(e.target.value)}
            className={selectCls}
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-[var(--status-error-fg)]">
          {error}
        </p>
      )}
      <Button
        variant="default"
        loading={pending}
        loadingText="Saving…"
        disabled={pending}
        onClick={save}
        className="self-start"
      >
        Save changes
      </Button>
    </div>
  );
}
