"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Proposal } from "@/lib/ai/tools/proposals";

interface ProposalCardProps {
  proposal: Proposal;
  brandId: string;
  onDone: (outcome: "confirmed" | "dismissed") => void;
}

const KIND_LABELS: Record<Proposal["kind"], string> = {
  brand_fields: "Brand profile update",
  design_ticket: "Design request",
  calendar: "Content calendar",
  strategy: "Content strategy",
};

export function ProposalCard({ proposal, brandId, onDone }: ProposalCardProps) {
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    if (confirming) return;
    setConfirming(true);
    try {
      const res = await fetch("/api/actions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, proposal }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(data?.error ?? "Something went wrong. Please try again.");
        return;
      }
      toast.success("Done — applied successfully.");
      onDone("confirmed");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <section className="max-w-[85%] space-y-3 rounded-xl border border-[var(--border)] bg-surface-1 p-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          {KIND_LABELS[proposal.kind]}
        </p>
        <p className="mt-1 text-[14px] font-semibold text-foreground">
          {proposal.summary}
        </p>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        {JSON.stringify(proposal.data, null, 2)}
      </pre>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          size="sm"
          disabled={confirming}
          onClick={() => onDone("dismissed")}
        >
          Dismiss
        </Button>
        <Button
          variant="default"
          size="sm"
          loading={confirming}
          loadingText="Confirming…"
          disabled={confirming}
          onClick={handleConfirm}
        >
          Confirm
        </Button>
      </div>
    </section>
  );
}
