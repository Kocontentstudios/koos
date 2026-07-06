"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { businessTypeOptions, stageOptions } from "../brand-profile-form";
import type { CreateBrandState } from "./create-brand-form";
import { Field, OtherSelect } from "./fields";
import { SuggestButton } from "./suggest-button";

interface StepProps {
  state: CreateBrandState;
  onChange: (patch: Partial<CreateBrandState>) => void;
}

export function StepBasics({ state, onChange }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="Brand / Business Name *" htmlFor="brand-name">
        <Input
          id="brand-name"
          placeholder="e.g., KO Skincare"
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </Field>

      <Field
        label="Business Overview *"
        htmlFor="brand-overview"
        hint={`What you do and who it's for. Minimum 20 characters${
          state.overview.length > 0 ? ` (${state.overview.length} / 500)` : ""
        }`}
      >
        <Textarea
          id="brand-overview"
          rows={3}
          placeholder="We make clean, affordable skincare products for young professionals who want effective routines without 20 steps."
          value={state.overview}
          onChange={(e) => onChange({ overview: e.target.value })}
        />
        <SuggestButton
          field="overview"
          state={state}
          onApply={(text) => onChange({ overview: text })}
        />
      </Field>

      <OtherSelect
        id="business-type"
        label="Business Type *"
        placeholder="Select a type..."
        options={businessTypeOptions}
        value={state.businessType}
        otherValue={state.businessTypeOther}
        onChange={(v) => onChange({ businessType: v })}
        onOtherChange={(v) => onChange({ businessTypeOther: v })}
      />

      <OtherSelect
        id="stage"
        label="Stage *"
        placeholder="Select your current stage..."
        options={stageOptions}
        value={state.stage}
        otherValue={state.stageOther}
        onChange={(v) => onChange({ stage: v })}
        onOtherChange={(v) => onChange({ stageOther: v })}
      />
    </div>
  );
}
