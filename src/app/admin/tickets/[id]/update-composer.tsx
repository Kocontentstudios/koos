"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { humanizeStatus } from "@/lib/design/tickets-ui";

const STATUS_OPTIONS = ["assigned", "in_progress", "ready_for_review"] as const;

export function UpdateComposer({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = message.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, status: status || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        const msg = data?.error ?? "Could not post the update.";
        setError(msg);
        toast.error(msg);
        return;
      }
      setMessage("");
      setStatus("");
      toast.success("Update posted");
      router.refresh();
    } catch {
      const msg = "Network error. Please try again.";
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-4">
      <Textarea
        value={message}
        disabled={pending}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Post a progress update the requester will see…"
        className="min-h-[80px]"
      />
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={status}
          disabled={pending}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-lg border border-[var(--border)] bg-surface-1 px-2 text-[13px] text-foreground"
        >
          <option value="">No status change</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {humanizeStatus(s)}
            </option>
          ))}
        </select>
        <Button
          variant="default"
          loading={pending}
          loadingText="Posting…"
          disabled={pending || message.trim().length === 0}
          onClick={submit}
        >
          Post update
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-[var(--status-error-fg)]">
          {error}
        </p>
      )}
    </div>
  );
}
