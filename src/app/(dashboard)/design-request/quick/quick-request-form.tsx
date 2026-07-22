"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import {
  buildQuickRequestConversation,
  fallbackQuickBrief,
  type QuickRequestInput,
  quickRequestSchema,
} from "@/lib/design/quick-request";
import { DESIGN_TYPE_OPTIONS, isCarouselType } from "@/lib/design/tickets-ui";
import { pollGenerationJob } from "@/lib/generation/poll-job";
import { cn } from "@/lib/utils";
import { ensureQuickRequestBrand } from "./actions";

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

interface GeneratedBrief {
  title: string;
  designType: string;
  dimensions?: string;
  slides?: number;
  briefMarkdown: string;
  notes?: string;
}

interface ReviewState {
  brandId: string;
  input: QuickRequestInput;
  brief: GeneratedBrief;
  /** True when AI polish failed and the raw description is standing in. */
  degraded: boolean;
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
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [ticketNumber, setTicketNumber] = useState<number | null>(null);

  async function handleContinue() {
    if (generating) return;
    const parsed = quickRequestSchema.safeParse(toInput(draft));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your details");
      return;
    }
    const input = parsed.data;
    setError(null);
    setGenerating(true);
    try {
      const brand = await ensureQuickRequestBrand(input.businessName);
      if (!brand.ok) {
        setError(brand.error);
        return;
      }
      let brief: GeneratedBrief;
      let degraded = false;
      try {
        const res = await fetch("/api/design-brief/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandId: brand.brandId,
            conversation: buildQuickRequestConversation(input),
          }),
        });
        if (!res.ok) throw new Error("generate request rejected");
        const { jobId } = (await res.json()) as { jobId: string };
        const result = await pollGenerationJob<{ brief: GeneratedBrief }>(
          jobId,
        );
        brief = result.brief;
      } catch {
        // A model failure must not block a request whose entire premise is
        // "one design, no setup" — degrade the brief instead.
        degraded = true;
        brief = {
          title: input.designType,
          designType: input.designType,
          dimensions: input.dimensions,
          slides: input.slides,
          briefMarkdown: fallbackQuickBrief(input),
        };
      }
      setReview({ brandId: brand.brandId, input, brief, degraded });
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit() {
    if (!review || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/design-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: review.brandId,
          calendarItemId: null,
          briefId: null,
          designType: review.brief.designType,
          dimensions: review.brief.dimensions ?? null,
          slides: review.brief.slides ?? null,
          brief: review.brief.briefMarkdown,
          notes: review.brief.notes ?? null,
          deliveryEmail: review.input.deliveryEmail ?? null,
          dueDate: review.input.dueDate ?? null,
        }),
      });
      const data = (await res.json()) as
        | { ticket: { ticketNumber: number } }
        | { error: string };
      if (!res.ok || !("ticket" in data)) {
        setError(
          ("error" in data && data.error) ||
            "Could not submit your request. Please try again.",
        );
        return;
      }
      setTicketNumber(data.ticket.ticketNumber);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
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
        loading={generating}
        loadingText="Building your brief…"
        className="w-full justify-center"
      >
        Continue
      </Button>

      {review && (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-surface-1 p-5">
          <h2 className="text-[16px] font-semibold text-foreground">
            {review.brief.title}
          </h2>
          {review.degraded && (
            <p className="rounded-lg bg-[var(--status-pending-bg)] px-3 py-2 text-[13px] text-[var(--status-pending-fg)]">
              We couldn't polish this into a full brief, so we'll send your
              description as written. The design team will follow up if they
              need more.
            </p>
          )}
          <Markdown className="text-[13px]">
            {review.brief.briefMarkdown}
          </Markdown>
          {ticketNumber === null ? (
            <Button
              variant="default"
              onClick={handleSubmit}
              loading={submitting}
              loadingText="Submitting…"
              className="w-full justify-center"
            >
              Submit Request
            </Button>
          ) : (
            <p className="rounded-lg bg-[var(--status-ready-bg)] px-3 py-2 text-[13px] font-medium text-[var(--status-ready-fg)]">
              Request KO-{ticketNumber} sent to the KO design team.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
