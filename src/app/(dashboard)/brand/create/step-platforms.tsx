"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  postingFrequencyOptions,
  primaryPlatformOptions,
} from "../brand-profile-form";
import type { CreateBrandState } from "./create-brand-form";
import { Field, OtherSelect, PlatformChips } from "./fields";

interface StepProps {
  state: CreateBrandState;
  onChange: (patch: Partial<CreateBrandState>) => void;
}

export function StepPlatforms({ state, onChange }: StepProps) {
  function togglePlatform(platform: string) {
    const next = state.platforms.includes(platform)
      ? state.platforms.filter((p) => p !== platform)
      : [...state.platforms, platform];
    onChange({ platforms: next });
  }

  return (
    <div className="flex flex-col gap-5">
      <Field label="Active Platforms">
        <PlatformChips
          selected={state.platforms}
          other={state.platformsOther}
          onToggle={togglePlatform}
          onOtherChange={(v) => onChange({ platformsOther: v })}
        />
      </Field>

      <Field label="Primary Platform" htmlFor="primary-platform">
        <Select
          value={state.primaryPlatform}
          onValueChange={(v) => onChange({ primaryPlatform: v ?? "" })}
        >
          <SelectTrigger id="primary-platform" className="w-full">
            <SelectValue placeholder="Select primary platform..." />
          </SelectTrigger>
          <SelectContent>
            {primaryPlatformOptions.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <OtherSelect
        id="posting-frequency"
        label="Posting Frequency"
        placeholder="Select frequency..."
        options={postingFrequencyOptions}
        value={state.postingFrequency}
        otherValue={state.postingFrequencyOther}
        onChange={(v) => onChange({ postingFrequency: v })}
        onOtherChange={(v) => onChange({ postingFrequencyOther: v })}
        otherSentinel="Custom"
      />
    </div>
  );
}
