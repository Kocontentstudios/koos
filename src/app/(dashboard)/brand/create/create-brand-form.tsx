"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveBrandProfile } from "@/app/(dashboard)/brand/actions";
import { Button } from "@/components/ui/button";
import { ProgressSteps } from "@/components/ui/progress-steps";
import { OTHER_OPTION } from "../brand-profile-form";
import { StepAnythingElse } from "./step-anything-else";
import { StepBasics } from "./step-basics";
import { StepCompetitors } from "./step-competitors";
import { StepDirection } from "./step-direction";
import { StepPersonality } from "./step-personality";
import { StepPlatforms } from "./step-platforms";
import { StepVisual } from "./step-visual";

const STORAGE_KEY = "ko-os:brand-create";
const STEPS = [
  "Business Basics",
  "Brand Direction",
  "Brand Personality",
  "Visual Identity",
  "Competitors",
  "Platforms",
  "Anything Else",
];

export interface CreateBrandState {
  // Section 1 — Business Basics
  name: string;
  overview: string;
  businessType: string;
  businessTypeOther: string;
  stage: string;
  stageOther: string;
  // Section 2 — Brand Direction
  targetAudience: string;
  offer: string;
  tone: string;
  toneOther: string;
  primaryGoal: string;
  // Section 3 — Brand Personality
  values: string;
  wordsLove: string;
  wordsAvoid: string;
  // Section 4 — Visual Identity
  hasLogo: string; // "", "Yes", "No"
  brandStyle: string;
  brandStyleOther: string;
  primaryColor: string;
  secondaryColor: string;
  additionalColors: string[];
  logoUrl: string;
  // Section 5 — Competitors
  competitors: string;
  competitorStrengths: string;
  differentiators: string;
  // Section 6 — Platforms & Posting
  platforms: string[];
  platformsOther: string;
  primaryPlatform: string;
  postingFrequency: string;
  postingFrequencyOther: string;
  // Section 7 — Anything Else
  additionalNotes: string;
  helpfulLinks: string;
}

const DEFAULT_STATE: CreateBrandState = {
  name: "",
  overview: "",
  businessType: "",
  businessTypeOther: "",
  stage: "",
  stageOther: "",
  targetAudience: "",
  offer: "",
  tone: "",
  toneOther: "",
  primaryGoal: "",
  values: "",
  wordsLove: "",
  wordsAvoid: "",
  hasLogo: "",
  brandStyle: "",
  brandStyleOther: "",
  primaryColor: "#138BC8",
  secondaryColor: "#FFFFFF",
  additionalColors: [],
  logoUrl: "",
  competitors: "",
  competitorStrengths: "",
  differentiators: "",
  platforms: [],
  platformsOther: "",
  primaryPlatform: "",
  postingFrequency: "",
  postingFrequencyOther: "",
  additionalNotes: "",
  helpfulLinks: "",
};

/** Resolve a select value that may be the "Other (Specify)" sentinel. */
function resolveOther(value: string, other: string, sentinel = OTHER_OPTION) {
  if (value === sentinel) return other.trim() || undefined;
  return value || undefined;
}

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

  // Step 0 (Business Basics) is the only required section
  const step0Valid =
    state.name.trim().length >= 2 &&
    state.overview.trim().length >= 20 &&
    state.businessType !== "" &&
    (state.businessType !== OTHER_OPTION ||
      state.businessTypeOther.trim() !== "") &&
    state.stage !== "" &&
    (state.stage !== OTHER_OPTION || state.stageOther.trim() !== "");

  function handleNext() {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  }

  function handlePrevious() {
    if (step > 0) setStep((s) => s - 1);
  }

  function buildPayload() {
    const platforms = state.platforms
      .filter((p) => p !== "Other")
      .concat(
        state.platforms.includes("Other") && state.platformsOther.trim()
          ? state.platformsOther
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      );

    return {
      name: state.name.trim(),
      overview: state.overview.trim(),
      businessType: resolveOther(state.businessType, state.businessTypeOther),
      stage: resolveOther(state.stage, state.stageOther),
      targetAudience: state.targetAudience.trim() || undefined,
      offer: state.offer.trim() || undefined,
      tone: resolveOther(state.tone, state.toneOther),
      primaryGoal: state.primaryGoal || undefined,
      values: state.values.trim() || undefined,
      wordsLove: state.wordsLove.trim() || undefined,
      wordsAvoid: state.wordsAvoid.trim() || undefined,
      hasLogo:
        state.hasLogo === "Yes"
          ? true
          : state.hasLogo === "No"
            ? false
            : undefined,
      brandStyle: resolveOther(state.brandStyle, state.brandStyleOther),
      primaryColor: state.primaryColor || undefined,
      secondaryColor: state.secondaryColor || undefined,
      additionalColors: state.additionalColors,
      logoUrl: state.logoUrl || undefined,
      competitors: state.competitors.trim() || undefined,
      competitorStrengths: state.competitorStrengths.trim() || undefined,
      differentiators: state.differentiators.trim() || undefined,
      platforms,
      primaryPlatform: state.primaryPlatform || undefined,
      postingFrequency: resolveOther(
        state.postingFrequency,
        state.postingFrequencyOther,
        "Custom",
      ),
      additionalNotes: state.additionalNotes.trim() || undefined,
      helpfulLinks: state.helpfulLinks.trim() || undefined,
    };
  }

  function handleSubmit() {
    if (!step0Valid) {
      toast.error("Please complete the required Business Basics fields");
      setStep(0);
      return;
    }
    startTransition(async () => {
      const res = await saveBrandProfile(buildPayload());
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
          Section 1 is all we need to get started — everything after sharpens
          the AI Strategy Generator. You can skip ahead and come back later.
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
        {step === 2 && (
          <StepPersonality state={state} onChange={handleChange} />
        )}
        {step === 3 && <StepVisual state={state} onChange={handleChange} />}
        {step === 4 && (
          <StepCompetitors state={state} onChange={handleChange} />
        )}
        {step === 5 && <StepPlatforms state={state} onChange={handleChange} />}
        {step === 6 && (
          <StepAnythingElse state={state} onChange={handleChange} />
        )}
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

        <div className="flex items-center gap-3">
          {/* Once Section 1 is valid the user can finish from any step. */}
          {step > 0 && step < STEPS.length - 1 && (
            <Button
              variant="ghost"
              onClick={handleSubmit}
              disabled={isPending || !step0Valid}
            >
              {isPending ? "Saving…" : "Create Profile"}
            </Button>
          )}

          {step < STEPS.length - 1 ? (
            <Button onClick={handleNext} disabled={step === 0 && !step0Valid}>
              Next
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isPending || !step0Valid}>
              {isPending ? "Saving…" : "Save Brand"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
