"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { primaryGoalOptions, toneOptions } from "../brand-profile-form";
import type { CreateBrandState } from "./create-brand-form";
import { Field, OtherSelect } from "./fields";

interface StepProps {
  state: CreateBrandState;
  onChange: (patch: Partial<CreateBrandState>) => void;
}

export function StepDirection({ state, onChange }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] font-medium text-[var(--text-muted)]">
        Optional · Recommended
      </p>

      <Field label="Target Audience" htmlFor="target-audience">
        <Input
          id="target-audience"
          placeholder="e.g., Women 22–38, urban, Instagram-active, care about ingredients"
          value={state.targetAudience}
          onChange={(e) => onChange({ targetAudience: e.target.value })}
        />
      </Field>

      <Field label="Offer" htmlFor="brand-offer">
        <Input
          id="brand-offer"
          placeholder="e.g., A 3-step skincare kit for $49"
          value={state.offer}
          onChange={(e) => onChange({ offer: e.target.value })}
        />
      </Field>

      <OtherSelect
        id="brand-tone"
        label="Tone / Voice"
        placeholder="Select a tone..."
        options={toneOptions}
        value={state.tone}
        otherValue={state.toneOther}
        onChange={(v) => onChange({ tone: v })}
        onOtherChange={(v) => onChange({ toneOther: v })}
      />

      <Field label="Primary Goal" htmlFor="primary-goal">
        <Select
          value={state.primaryGoal}
          onValueChange={(v) => onChange({ primaryGoal: v ?? "" })}
        >
          <SelectTrigger id="primary-goal" className="w-full">
            <SelectValue placeholder="Select your main objective..." />
          </SelectTrigger>
          <SelectContent>
            {primaryGoalOptions.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}
