"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ReviewActions({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"approve" | "revise" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "approve" | "revise") {
    if (pending) return;
    setPending(action);
    setError(null);
    try {
      const res = await fetch(`/api/design-tickets/${ticketId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          note: action === "revise" ? note.trim() || undefined : undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        const msg = data?.error ?? "Something went wrong. Please try again.";
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success(
        action === "approve" ? "Design approved" : "Revision requested",
      );
      router.refresh();
    } catch {
      const msg = "Network error. Please try again.";
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] bg-surface-1 p-5">
      <h2 className="text-[15px] font-semibold text-foreground">
        Review this design
      </h2>
      <p className="text-[13px] text-[var(--text-secondary)]">
        Approve to mark it delivered, or request a revision with a note for the
        designer.
      </p>
      <Textarea
        aria-label="Revision note"
        value={note}
        disabled={pending !== null}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What needs changing? (optional, for revisions)"
        className="min-h-[80px]"
      />
      {error && (
        <p role="alert" className="text-[13px] text-[var(--status-error-fg)]">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          size="lg"
          loading={pending === "revise"}
          loadingText="Sending…"
          disabled={pending !== null}
          onClick={() => submit("revise")}
        >
          Request Revision
        </Button>
        <Button
          variant="default"
          size="lg"
          loading={pending === "approve"}
          loadingText="Approving…"
          disabled={pending !== null}
          onClick={() => submit("approve")}
        >
          Approve
        </Button>
      </div>
    </section>
  );
}
