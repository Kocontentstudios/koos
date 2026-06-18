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
import type { CreateBrandState } from "./create-brand-form";

const toneLabels: Record<string, string> = {
  professional: "Professional & Authoritative",
  friendly: "Friendly & Conversational",
  playful: "Playful & Fun",
  bold: "Bold & Edgy",
  calm: "Calm & Trustworthy",
  luxurious: "Luxurious & Sophisticated",
  educational: "Educational & Helpful",
  aspirational: "Aspirational & Inspirational",
};

const primaryGoalLabels: Record<string, string> = {
  product_launch: "Product Launch",
  brand_awareness: "Brand Awareness",
  drive_sales: "Drive Sales / Conversions",
  grow_social: "Grow Social Following",
  build_email: "Build Email List",
  reengage: "Re-engage Customers",
  seasonal: "Seasonal Promotion",
  thought_leadership: "Thought Leadership",
};

interface StepDirectionProps {
  state: CreateBrandState;
  onChange: (patch: Partial<CreateBrandState>) => void;
}

export function StepDirection({ state, onChange }: StepDirectionProps) {
  return (
    <div className="flex flex-col gap-5">
      {/* Target Audience */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="target-audience">Target Audience</Label>
        <Input
          id="target-audience"
          placeholder="e.g. Small business owners aged 25–45"
          value={state.targetAudience}
          onChange={(e) => onChange({ targetAudience: e.target.value })}
        />
      </div>

      {/* Core Offer */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brand-offer">Core Offer</Label>
        <Input
          id="brand-offer"
          placeholder="e.g. Social media marketing services"
          value={state.offer}
          onChange={(e) => onChange({ offer: e.target.value })}
        />
      </div>

      {/* Tone */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brand-tone">Brand Tone</Label>
        <Select
          value={state.tone}
          onValueChange={(val) => onChange({ tone: val ?? "" })}
        >
          <SelectTrigger id="brand-tone" className="w-full">
            <SelectValue placeholder="Select brand tone" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(toneLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Primary Goal */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="primary-goal">Primary Goal</Label>
        <Select
          value={state.primaryGoal}
          onValueChange={(val) => onChange({ primaryGoal: val ?? "" })}
        >
          <SelectTrigger id="primary-goal" className="w-full">
            <SelectValue placeholder="Select primary goal" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(primaryGoalLabels).map(([value, label]) => (
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
