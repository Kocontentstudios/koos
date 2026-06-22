"use client";

import { Input } from "@/components/ui/input";
import type { CreateBrandState } from "./create-brand-form";
import { Field } from "./fields";

interface StepProps {
  state: CreateBrandState;
  onChange: (patch: Partial<CreateBrandState>) => void;
}

export function StepPersonality({ state, onChange }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] font-medium text-[var(--text-muted)]">
        Optional
      </p>

      <Field label="Brand Values (3–5)" htmlFor="brand-values">
        <Input
          id="brand-values"
          placeholder="e.g., Honesty, simplicity, effectiveness"
          value={state.values}
          onChange={(e) => onChange({ values: e.target.value })}
        />
      </Field>

      <Field label="Words You Love Using" htmlFor="words-love">
        <Input
          id="words-love"
          placeholder="e.g., Glow, routine, skin-first"
          value={state.wordsLove}
          onChange={(e) => onChange({ wordsLove: e.target.value })}
        />
      </Field>

      <Field label="Words to Avoid" htmlFor="words-avoid">
        <Input
          id="words-avoid"
          placeholder="e.g., Miracle, cure, guaranteed results"
          value={state.wordsAvoid}
          onChange={(e) => onChange({ wordsAvoid: e.target.value })}
        />
      </Field>
    </div>
  );
}
