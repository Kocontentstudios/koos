"use client";

import { ArrowRight, Info } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveBrandProfile } from "@/app/(dashboard)/brand/actions";
import { Button } from "@/components/ui/button";
import { OTHER_OPTION } from "../brand-profile-form";
import {
  type CreateBrandState,
  DEFAULT_STATE,
  STORAGE_KEY,
} from "./brand-form-state";
import { ProgressSteps } from "./progress-steps";
import { StepAnythingElse } from "./step-anything-else";
import { StepBasics } from "./step-basics";
import { StepCompetitors } from "./step-competitors";
import { StepDirection } from "./step-direction";
import { StepPersonality } from "./step-personality";
import { StepPlatforms } from "./step-platforms";
import { StepVisual } from "./step-visual";

export type { CreateBrandState } from "./brand-form-state";

interface StepMeta {
  /** Short label shown in the progress bar. */
  label: string;
  /** Section-title band heading. */
  title: string;
  /** Status badge copy shown next to the heading. */
  status: string;
  /** Whether the status should read as required (error-colored). */
  required?: boolean;
  /** Per-step "Next" button copy. Empty on the final step. */
  next: string;
}

const STEPS: StepMeta[] = [
  {
    label: "Basics",
    title: "Business Basics",
    status: "Required",
    required: true,
    next: "Next: Brand Direction",
  },
  {
    label: "Direction",
    title: "Brand Direction",
    status: "Optional · Recommended",
    next: "Next: Brand Personality",
  },
  {
    label: "Personality",
    title: "Brand Personality",
    status: "Optional",
    next: "Next: Visual Identity",
  },
  {
    label: "Visual",
    title: "Visual Identity",
    status: "Optional",
    next: "Next: Competitors",
  },
  {
    label: "Competitors",
    title: "Competitors",
    status: "Optional",
    next: "Next: Platforms",
  },
  {
    label: "Platforms",
    title: "Platforms & Posting",
    status: "Optional · Recommended",
    next: "Next: Anything Else",
  },
  {
    label: "Anything Else",
    title: "Anything Else",
    status: "Optional",
    next: "",
  },
];

const STEP_LABELS = STEPS.map((s) => s.label);

/** Resolve a select value that may be the "Other (Specify)" sentinel. */
function resolveOther(value: string, other: string, sentinel = OTHER_OPTION) {
  if (value === sentinel) return other.trim() || undefined;
  return value || undefined;
}

export function CreateBrandForm({
  initialBrand = null,
}: {
  initialBrand?: CreateBrandState | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<CreateBrandState>(
    initialBrand ?? DEFAULT_STATE,
  );
  const [isPending, startTransition] = useTransition();
  const isEditing = initialBrand !== null;

  // Restore an in-progress draft from localStorage only for a brand-new profile.
  // When editing, the server-provided brand is authoritative, so we ignore drafts.
  useEffect(() => {
    if (isEditing) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<CreateBrandState>;
        setState((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // Ignore parse errors
    }
  }, [isEditing]);

  // Persist to localStorage on every state change — new-user drafts only.
  // When editing, skip so we don't write dead draft data over the server-provided brand.
  useEffect(() => {
    if (isEditing) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage errors
    }
  }, [state, isEditing]);

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

  // Direct jumps from the step indicator. Business Basics (step 0) is the
  // only gated section: jumping forward past it while invalid is blocked.
  function handleStepSelect(target: number) {
    if (target === step) return;
    if (target > 0 && !step0Valid) {
      toast.error("Please complete the required Business Basics fields first");
      setStep(0);
      return;
    }
    setStep(target);
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
        router.push(isEditing ? "/brand" : "/strategy");
      } else {
        toast.error(res.error);
      }
    });
  }

  const meta = STEPS[step];
  const isFinalStep = step === STEPS.length - 1;

  return (
    <div className="w-full px-4 py-8 md:px-6 lg:px-8">
      {/* Welcome banner — first step only */}
      {step === 0 && (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-surface-2 px-4 py-3 text-[13px] text-[var(--text-secondary)]">
          <Info className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            Welcome! Let&apos;s set up your brand first. This helps us create
            better strategies for you.
          </span>
        </div>
      )}

      {/* Heading */}
      <div className="mb-8">
        <h1 className="font-display text-[32px] font-bold text-foreground">
          Create Your Brand
        </h1>
        <p className="mt-2 max-w-xl text-[var(--text-secondary)]">
          Section 1 is all we need to get started — everything after sharpens
          the AI Strategy Generator. You can skip ahead and come back later.
        </p>
      </div>

      {/* Progress */}
      <div className="mb-8">
        <ProgressSteps
          steps={STEP_LABELS}
          current={step}
          onSelect={handleStepSelect}
        />
      </div>

      {/* Unified card: section-title band → fields → action bar */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-surface-1">
        {/* Section-title band */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 md:px-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[18px] font-semibold text-foreground">
              {meta.title}
            </h2>
            <span
              className={
                meta.required
                  ? "text-[12px] font-medium text-[var(--error)]"
                  : "text-[12px] font-medium text-[var(--text-muted)]"
              }
            >
              {meta.status}
            </span>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--border)] bg-surface-2 px-2.5 py-1 text-[11px] font-medium whitespace-nowrap text-[var(--text-muted)]">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>

        <div className="h-px bg-[var(--divider)]" />

        {/* Step content */}
        <div className="px-5 py-6 md:px-6">
          {step === 0 && <StepBasics state={state} onChange={handleChange} />}
          {step === 1 && (
            <StepDirection state={state} onChange={handleChange} />
          )}
          {step === 2 && (
            <StepPersonality state={state} onChange={handleChange} />
          )}
          {step === 3 && <StepVisual state={state} onChange={handleChange} />}
          {step === 4 && (
            <StepCompetitors state={state} onChange={handleChange} />
          )}
          {step === 5 && (
            <StepPlatforms state={state} onChange={handleChange} />
          )}
          {step === 6 && (
            <StepAnythingElse state={state} onChange={handleChange} />
          )}
        </div>

        <div className="h-px bg-[var(--divider)]" />

        {/* Action bar — sticky to bottom, wraps on mobile */}
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-surface-1 px-5 py-4 md:px-6">
          {step > 0 ? (
            <Button
              variant="ghost"
              size="lg"
              className="h-11 px-5"
              onClick={handlePrevious}
              disabled={isPending}
            >
              Previous
            </Button>
          ) : (
            <div />
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {/* Once Section 1 is valid the user can finish from any step. */}
            {step > 0 && !isFinalStep && (
              <Button
                variant="ghost"
                size="lg"
                className="h-11 px-5"
                onClick={handleSubmit}
                loading={isPending}
                loadingText="Saving…"
                disabled={!step0Valid}
              >
                Create Profile
              </Button>
            )}

            {!isFinalStep ? (
              <Button
                size="lg"
                className="h-11 px-5"
                onClick={handleNext}
                disabled={step === 0 && !step0Valid}
              >
                {meta.next}
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : (
              <Button
                size="lg"
                className="h-11 px-5"
                onClick={handleSubmit}
                loading={isPending}
                loadingText="Saving…"
                disabled={!step0Valid}
              >
                Create Profile
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-[var(--border)] border-l-[3px] border-l-[var(--warning)] bg-surface-1 p-5">
        <h4 className="text-[15px] font-bold text-foreground">
          Just need one design right now?
        </h4>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          You can request a single design without finishing your brand profile.
          We'll save what you've entered so far.
        </p>
        <Link
          href="/design-request/quick"
          className="mt-4 inline-flex h-9 items-center rounded-lg bg-[var(--status-pending-bg)] px-4 text-[13px] font-semibold text-[var(--status-pending-fg)] transition-colors hover:bg-[rgba(212,169,84,0.28)]"
        >
          Request a Design
        </Link>
      </div>
    </div>
  );
}
