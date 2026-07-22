"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type QuickRequestInput,
  quickRequestSchema,
} from "@/lib/design/quick-request";
import { DESIGN_TYPE_OPTIONS, isCarouselType } from "@/lib/design/tickets-ui";
import { cn } from "@/lib/utils";

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-surface-1 px-3 py-2 text-[14px] text-foreground transition-colors hover:border-[var(--border-accent)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)]";

const labelCls =
  "mb-1 block text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]";

interface Draft {
  businessName: string;
  designType: string;
  dimensions: string;
  slides: string;
  description: string;
  deliveryEmail: string;
  dueDate: string;
}

interface QuickRequestFormProps {
  defaultBusinessName: string;
  defaultDeliveryEmail: string;
}

function toInput(draft: Draft): unknown {
  return {
    businessName: draft.businessName,
    designType: draft.designType,
    dimensions: draft.dimensions.trim() || undefined,
    slides:
      isCarouselType(draft.designType) && draft.slides.trim()
        ? Number(draft.slides)
        : undefined,
    description: draft.description,
    deliveryEmail: draft.deliveryEmail.trim() || undefined,
    dueDate: draft.dueDate.trim() || undefined,
  };
}

export function QuickRequestForm({
  defaultBusinessName,
  defaultDeliveryEmail,
}: QuickRequestFormProps) {
  const [draft, setDraft] = useState<Draft>({
    businessName: defaultBusinessName,
    designType: DESIGN_TYPE_OPTIONS[1],
    dimensions: "",
    slides: "",
    description: "",
    deliveryEmail: defaultDeliveryEmail,
    dueDate: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<QuickRequestInput | null>(null);

  function handleContinue() {
    const parsed = quickRequestSchema.safeParse(toInput(draft));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your details");
      return;
    }
    setError(null);
    setAccepted(parsed.data);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className={labelCls} htmlFor="quick-business-name">
          Business name
        </label>
        <input
          id="quick-business-name"
          className={inputCls}
          value={draft.businessName}
          onChange={(e) => setDraft({ ...draft, businessName: e.target.value })}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="quick-design-type">
          What do you need designed?
        </label>
        <select
          id="quick-design-type"
          className={inputCls}
          value={draft.designType}
          onChange={(e) => setDraft({ ...draft, designType: e.target.value })}
        >
          {DESIGN_TYPE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      {isCarouselType(draft.designType) && (
        <div>
          <label className={labelCls} htmlFor="quick-slides">
            Slides
          </label>
          <input
            id="quick-slides"
            className={inputCls}
            type="number"
            min={2}
            max={10}
            value={draft.slides}
            onChange={(e) => setDraft({ ...draft, slides: e.target.value })}
          />
        </div>
      )}

      <div>
        <label className={labelCls} htmlFor="quick-dimensions">
          Dimensions (optional)
        </label>
        <input
          id="quick-dimensions"
          className={inputCls}
          placeholder="e.g. 1080x1350"
          value={draft.dimensions}
          onChange={(e) => setDraft({ ...draft, dimensions: e.target.value })}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="quick-description">
          Describe what you need
        </label>
        <textarea
          id="quick-description"
          className={cn(inputCls, "min-h-[140px]")}
          placeholder="What is it for, what should it say, and what should it achieve?"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="quick-delivery-email">
          Delivery email
        </label>
        <input
          id="quick-delivery-email"
          className={inputCls}
          value={draft.deliveryEmail}
          onChange={(e) =>
            setDraft({ ...draft, deliveryEmail: e.target.value })
          }
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="quick-due-date">
          Needed by (optional)
        </label>
        <input
          id="quick-due-date"
          className={inputCls}
          type="date"
          value={draft.dueDate}
          onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
        />
      </div>

      {error && (
        <p className="rounded-lg bg-[var(--status-error-bg)] px-3 py-2 text-[13px] text-[var(--status-error-fg)]">
          {error}
        </p>
      )}

      <Button
        variant="default"
        size="lg"
        onClick={handleContinue}
        className="w-full justify-center"
      >
        Continue
      </Button>

      {accepted && (
        <p className="text-[13px] text-[var(--text-muted)]">
          Ready to build your brief.
        </p>
      )}
    </div>
  );
}
