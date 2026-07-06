"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CreateBrandState } from "./create-brand-form";
import { Field } from "./fields";
import { SuggestButton } from "./suggest-button";

interface StepProps {
  state: CreateBrandState;
  onChange: (patch: Partial<CreateBrandState>) => void;
}

export function StepCompetitors({ state, onChange }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="Top Competitors" htmlFor="competitors">
        <Input
          id="competitors"
          placeholder="Names or links — e.g., Cocoa Bloom, The Skin Bar NG"
          value={state.competitors}
          onChange={(e) => onChange({ competitors: e.target.value })}
        />
      </Field>

      <Field label="What They Do Well" htmlFor="competitor-strengths">
        <Textarea
          id="competitor-strengths"
          rows={3}
          placeholder="e.g., Strong Instagram Reels, fast shipping."
          value={state.competitorStrengths}
          onChange={(e) => onChange({ competitorStrengths: e.target.value })}
        />
      </Field>

      <Field label="What You Want to Do Differently" htmlFor="differentiators">
        <Textarea
          id="differentiators"
          rows={3}
          placeholder="e.g., More ingredient education, less hype."
          value={state.differentiators}
          onChange={(e) => onChange({ differentiators: e.target.value })}
        />
        <SuggestButton
          field="differentiators"
          state={state}
          onApply={(text) => onChange({ differentiators: text })}
        />
      </Field>
    </div>
  );
}
