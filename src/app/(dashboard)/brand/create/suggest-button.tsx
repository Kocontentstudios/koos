"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type {
  BrandSuggestContext,
  BrandSuggestField,
} from "@/lib/ai/prompts/brand";
import { cn } from "@/lib/utils";
import type { CreateBrandState } from "./brand-form-state";

function toContext(state: CreateBrandState): BrandSuggestContext {
  return {
    name: state.name,
    overview: state.overview,
    businessType: state.businessType,
    stage: state.stage,
    targetAudience: state.targetAudience,
    offer: state.offer,
    tone: state.tone,
    values: state.values,
    differentiators: state.differentiators,
    primaryGoal: state.primaryGoal,
  };
}

export function SuggestButton({
  field,
  state,
  onApply,
}: {
  field: BrandSuggestField;
  state: CreateBrandState;
  onApply: (text: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const currentValue = state[field];
  const label = currentValue.trim().length > 0 ? "Enhance" : "Suggest";

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/brand/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field,
          currentValue,
          context: toContext(state),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Suggestion failed");
      }
      const data = (await res.json()) as { suggestion: string };
      if (data.suggestion?.trim()) onApply(data.suggestion.trim());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suggestion failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-label={`${label} with AI`}
      className={cn(
        "inline-flex items-center gap-1 self-start rounded-lg border border-[var(--border)] px-2.5 py-1 text-[12px] font-medium text-primary transition-colors hover:border-[var(--border-accent)] hover:bg-[var(--accent-glow)]",
        loading && "opacity-50 cursor-not-allowed",
      )}
    >
      <Sparkles className="size-3" aria-hidden="true" />
      {loading ? "Thinking…" : label}
    </button>
  );
}
