"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { OTHER_OPTION, platformOptions } from "../brand-profile-form";

/** Labeled field wrapper used across all onboarding steps. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-[12px] text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

/**
 * A dropdown that reveals an "Other (Specify)" free-text input when the
 * sentinel option is chosen. Mirrors the data-other-specify behavior in
 * create-brand.html.
 */
export function OtherSelect({
  id,
  label,
  placeholder,
  options,
  value,
  otherValue,
  onChange,
  onOtherChange,
  otherSentinel = OTHER_OPTION,
}: {
  id: string;
  label: string;
  placeholder: string;
  options: readonly string[];
  value: string;
  otherValue: string;
  onChange: (value: string) => void;
  onOtherChange: (value: string) => void;
  otherSentinel?: string;
}) {
  const showOther = value === otherSentinel;
  return (
    <Field label={label} htmlFor={id}>
      <Select value={value} onValueChange={(v) => onChange(v ?? "")}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showOther && (
        <Input
          className="mt-2"
          placeholder="Please specify"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/** Multi-select chip group for Active Platforms. */
export function PlatformChips({
  selected,
  other,
  onToggle,
  onOtherChange,
}: {
  selected: string[];
  other: string;
  onToggle: (platform: string) => void;
  onOtherChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-2">
        {platformOptions.map((platform) => {
          const active = selected.includes(platform);
          return (
            <button
              key={platform}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(platform)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                active
                  ? "border-[var(--border-accent)] bg-[var(--accent-glow)] text-primary"
                  : "border-border bg-[var(--surface-container-low)] text-text-secondary hover:border-border-hover",
              )}
            >
              {platform}
            </button>
          );
        })}
      </div>
      {selected.includes("Other") && (
        <Input
          placeholder="Other platforms (comma-separated)"
          value={other}
          onChange={(e) => onOtherChange(e.target.value)}
        />
      )}
    </div>
  );
}
