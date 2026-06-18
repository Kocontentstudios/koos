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
import { Textarea } from "@/components/ui/textarea";
import type { CreateBrandState } from "./create-brand-form";

const businessTypeLabels: Record<string, string> = {
  ecommerce: "E-commerce / Product",
  service: "Service-based",
  saas: "SaaS / Technology",
  creator: "Content Creator / Influencer",
  agency: "Agency / Consultancy",
  nonprofit: "Non-profit",
  restaurant: "Restaurant / Food",
  fashion: "Fashion / Beauty",
  health: "Health / Wellness",
  education: "Education",
  other: "Other",
};

const stageLabels: Record<string, string> = {
  pre_launch: "Pre-launch / New business",
  early_growth: "Early growth (1-2 years)",
  established: "Established (3+ years)",
  rebranding: "Rebranding",
  new_product: "Launching a new product/service",
};

interface StepBasicsProps {
  state: CreateBrandState;
  onChange: (patch: Partial<CreateBrandState>) => void;
}

export function StepBasics({ state, onChange }: StepBasicsProps) {
  return (
    <div className="flex flex-col gap-5">
      {/* Brand Name */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brand-name">Brand Name</Label>
        <Input
          id="brand-name"
          placeholder="e.g. Acme Co."
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>

      {/* Overview */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brand-overview">Brand Overview</Label>
        <Textarea
          id="brand-overview"
          placeholder="Describe your business, what you do, and who you serve…"
          rows={4}
          value={state.overview}
          onChange={(e) => onChange({ overview: e.target.value })}
        />
        <p className="text-[12px] text-[var(--text-muted)]">
          Minimum 20 characters
          {state.overview.length > 0 && (
            <span
              className={
                state.overview.length >= 20
                  ? " text-[var(--status-success-fg)]"
                  : ""
              }
            >
              {" "}
              ({state.overview.length} / 500)
            </span>
          )}
        </p>
      </div>

      {/* Business Type */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="business-type">Business Type</Label>
        <Select
          value={state.businessType}
          onValueChange={(val) => onChange({ businessType: val ?? "" })}
        >
          <SelectTrigger id="business-type" className="w-full">
            <SelectValue placeholder="Select business type" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(businessTypeLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Stage */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brand-stage">Business Stage</Label>
        <Select
          value={state.stage}
          onValueChange={(val) => onChange({ stage: val ?? "" })}
        >
          <SelectTrigger id="brand-stage" className="w-full">
            <SelectValue placeholder="Select stage" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(stageLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
