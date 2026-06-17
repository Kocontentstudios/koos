"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveBrandProfile } from "@/app/(dashboard)/brand/actions";
import { Button } from "@/components/ui/button";
import { ProgressSteps } from "@/components/ui/progress-steps";
import { StepAssets } from "./step-assets";
import { StepBasics } from "./step-basics";
import { StepDirection } from "./step-direction";

const STORAGE_KEY = "ko-os:brand-create";
const STEPS = ["Business Basics", "Brand Direction", "Brand Assets"];

export interface CreateBrandState {
  name: string;
  overview: string;
  businessType: string;
  stage: string;
  targetAudience: string;
  offer: string;
  tone: string;
  primaryGoal: string;
  primaryColor: string;
  secondaryColor: string;
  additionalColors: string[];
  logoUrl: string;
}

const DEFAULT_STATE: CreateBrandState = {
  name: "",
  overview: "",
  businessType: "",
  stage: "",
  targetAudience: "",
  offer: "",
  tone: "",
  primaryGoal: "",
  primaryColor: "#138BC8",
  secondaryColor: "#FFFFFF",
  additionalColors: [],
  logoUrl: "",
};

export function CreateBrandForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<CreateBrandState>(DEFAULT_STATE);
  const [isPending, startTransition] = useTransition();

  // Restore from localStorage on mount (SSR-safe)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<CreateBrandState>;
        setState((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Persist to localStorage on every state change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage errors
    }
  }, [state]);

  function handleChange(patch: Partial<CreateBrandState>) {
    setState((prev) => ({ ...prev, ...patch }));
  }

  // Step 0 validation — all four fields required
  const step0Valid =
    state.name.trim().length >= 2 &&
    state.overview.trim().length >= 20 &&
    state.businessType !== "" &&
    state.stage !== "";

  function handleNext() {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  }

  function handlePrevious() {
    if (step > 0) setStep((s) => s - 1);
  }

  function handleSubmit() {
    startTransition(async () => {
      const res = await saveBrandProfile(state);
      if (res.ok) {
        toast.success("Brand profile created!");
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Ignore
        }
        router.push("/strategy");
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      {/* Heading */}
      <div className="mb-8">
        <h1 className="font-display text-[32px] font-bold text-foreground">
          Create Your Brand
        </h1>
        <p className="mt-2 text-[var(--text-secondary)]">
          Tell us about your business. This helps our AI build better strategies
          and our designers create on-brand assets.
        </p>
      </div>

      {/* Progress */}
      <div className="mb-8">
        <ProgressSteps steps={STEPS} current={step} />
      </div>

      {/* Step content */}
      <div className="mb-8">
        {step === 0 && <StepBasics state={state} onChange={handleChange} />}
        {step === 1 && <StepDirection state={state} onChange={handleChange} />}
        {step === 2 && <StepAssets state={state} onChange={handleChange} />}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-3">
        {step > 0 ? (
          <Button
            variant="secondary"
            onClick={handlePrevious}
            disabled={isPending}
          >
            Previous
          </Button>
        ) : (
          <div />
        )}

        {step < STEPS.length - 1 ? (
          <Button onClick={handleNext} disabled={step === 0 && !step0Valid}>
            Next
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving…" : "Save Brand"}
          </Button>
        )}
      </div>
    </div>
  );
}
