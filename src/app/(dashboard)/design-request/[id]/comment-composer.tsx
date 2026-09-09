"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_COMMENT_LENGTH = 2000;

/**
 * Lets the brand side say something outside a formal review.
 *
 * Deliberately carries no status control: the review actions own the
 * approve / request-revision transitions, and a second way to move status
 * would let a comment silently reopen a ticket.
 */
export function CommentComposer({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = message.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/design-tickets/${ticketId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        const msg = data?.error ?? "Could not post your comment.";
        setError(msg);
        toast.error(msg);
        return;
      }
      setMessage("");
      toast.success("Comment sent to the design team");
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
        placeholder="Ask a question or add a note for the design team…"
        aria-label="Add a comment"
        className="min-h-[80px]"
        maxLength={MAX_COMMENT_LENGTH}
      />
      <div className="flex justify-end">
        <Button
          variant="default"
          loading={pending}
          loadingText="Sending…"
          disabled={pending || message.trim().length === 0}
          onClick={submit}
        >
          Send comment
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
