"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Proposal } from "@/lib/ai/tools/proposals";
import type { BrandSnapshotFields } from "@/lib/brand-snapshot";

/** What /api/actions/confirm reports back about the write it just made. */
export interface ConfirmResult {
  brandCompleted: boolean;
  /** Present once the brand is complete, so the caller can show the snapshot
   *  without re-fetching a row it just wrote. */
  snapshot?: BrandSnapshotFields;
}

interface ProposalCardProps {
  proposal: Proposal;
  brandId: string;
  /** The chat this proposal was made in. Sent on confirm so a strategy born
   * in chat stays attached to that chat. */
  conversationId?: string;
  onDone: (outcome: "confirmed" | "dismissed", result?: ConfirmResult) => void;
}

/* brand_fields is the one proposal a brand-new user meets, on their first
   screen in the product — it gets a readable summary of what was captured.
   The other kinds stay on the JSON dump: they surface deep in chat for users
   who already know the shape, and re-presenting them isn't this change. */
export const BRAND_FIELD_LABELS: Record<string, string> = {
  name: "Brand name",
  overview: "Overview",
  businessType: "Business type",
  stage: "Stage",
  targetAudience: "Target audience",
  offer: "Offer",
  tone: "Tone of voice",
  primaryGoal: "Primary goal",
  values: "Values",
  wordsLove: "Words we love",
  wordsAvoid: "Words we avoid",
  brandStyle: "Brand style",
  competitors: "Competitors",
  differentiators: "What we do better",
  competitorStrengths: "Where competitors lead",
  primaryColor: "Primary colour",
  secondaryColor: "Secondary colour",
  additionalColors: "Additional colours",
  platforms: "Active channels",
  primaryPlatform: "Primary channel",
  postingFrequency: "Posting frequency",
  websiteUrl: "Website",
  brandFont: "Typography",
  additionalNotes: "Additional notes",
};

function CapturedFields({ fields }: { fields: Record<string, unknown> }) {
  const entries = Object.entries(fields).filter(
    ([, value]) => typeof value === "string" && value.trim().length > 0,
  );
  if (entries.length === 0) {
    return (
      <p className="text-[13px] text-[var(--text-secondary)]">
        Nothing new to save yet — keep chatting and try again.
      </p>
    );
  }
  return (
    <dl className="divide-y divide-[var(--border)] rounded-lg bg-surface-2 px-3">
      {entries.map(([key, value]) => (
        <div key={key} className="grid gap-0.5 py-2.5 sm:grid-cols-[9rem_1fr]">
          <dt className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {BRAND_FIELD_LABELS[key] ?? key}
          </dt>
          <dd className="min-w-0 break-words text-[13px] leading-relaxed text-foreground">
            {value as string}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const KIND_LABELS: Record<Proposal["kind"], string> = {
  brand_fields: "Brand profile update",
  design_ticket: "Design request",
  calendar: "Content calendar",
  strategy: "Content strategy",
};

export function ProposalCard({
  proposal,
  brandId,
  conversationId,
  onDone,
}: ProposalCardProps) {
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    if (confirming) return;
    setConfirming(true);
    try {
      const res = await fetch("/api/actions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, proposal, conversationId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(data?.error ?? "Something went wrong. Please try again.");
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        brandCompleted?: boolean;
        snapshot?: BrandSnapshotFields;
      } | null;
      toast.success("Done — applied successfully.");
      onDone("confirmed", {
        brandCompleted: data?.brandCompleted === true,
        snapshot: data?.snapshot,
      });
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
      {proposal.kind === "brand_fields" ? (
        <CapturedFields fields={proposal.data.fields} />
      ) : (
        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-[12px] leading-relaxed text-[var(--text-secondary)]">
          {JSON.stringify(proposal.data, null, 2)}
        </pre>
      )}
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
