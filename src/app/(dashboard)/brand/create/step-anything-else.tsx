"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CreateBrandState } from "./create-brand-form";
import { Field } from "./fields";

interface StepProps {
  state: CreateBrandState;
  onChange: (patch: Partial<CreateBrandState>) => void;
}

export function StepAnythingElse({ state, onChange }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] font-medium text-[var(--text-muted)]">
        Optional
      </p>

      <Field label="Additional Notes" htmlFor="additional-notes">
        <Textarea
          id="additional-notes"
          rows={3}
          placeholder="Anything we haven't asked about that matters. e.g., We're launching in Lagos first, then expanding to Abuja in Q3."
          value={state.additionalNotes}
          onChange={(e) => onChange({ additionalNotes: e.target.value })}
        />
      </Field>

      <Field label="Helpful Links" htmlFor="helpful-links">
        <Input
          id="helpful-links"
          placeholder="Website, Drive folder, socials — comma-separated"
          value={state.helpfulLinks}
          onChange={(e) => onChange({ helpfulLinks: e.target.value })}
        />
      </Field>
    </div>
  );
}
