"use client";

import { CheckCircle2, Sparkles, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type AttachmentInput,
  type DesignTicketSpecs,
  formRequestSchema,
  MAX_UPLOAD_FILES,
} from "@/lib/design/request-form";
import {
  DESIGN_TYPE_OPTIONS,
  humanizePriority,
  priorityEta,
  type TicketPriority,
} from "@/lib/design/tickets-ui";
import { formatTicketNumber } from "@/lib/ticket-number";
import { cn } from "@/lib/utils";
import { TicketStatusBadge } from "../ticket-status-badge";
import { AttachmentUploader } from "./attachment-uploader";

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-surface-1 px-3 py-2 text-[14px] text-foreground transition-colors hover:border-[var(--border-accent)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-glow)]";

const labelCls =
  "mb-1 block text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]";

const sectionCls =
  "flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-surface-1 p-5 md:p-6";

const STORAGE_KEY = "koos.design-request.form";

const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

export interface BrandOption {
  id: string;
  name: string;
}

interface FormState {
  requestType: string;
  title: string;
  brandId: string;
  dueDate: string;
  priority: TicketPriority;
  brief: string;
  attachments: AttachmentInput[];
  referenceNote: string;
  specs: {
    platform: string;
    dimensions: string;
    orientation: "" | "portrait" | "landscape" | "square";
    fileFormat: string;
    deliverablesCount: string;
  };
}

export interface InitialDraft {
  id: string;
  state: FormState;
}

interface SubmittedTicket {
  id: string;
  ticketNumber: number;
  priority: TicketPriority;
}

function emptyState(brandId: string): FormState {
  return {
    requestType: DESIGN_TYPE_OPTIONS[0],
    title: "",
    brandId,
    dueDate: "",
    priority: "normal",
    brief: "",
    attachments: [],
    referenceNote: "",
    specs: {
      platform: "",
      dimensions: "",
      orientation: "",
      fileFormat: "",
      deliverablesCount: "",
    },
  };
}

function cleanedSpecs(state: FormState): DesignTicketSpecs | undefined {
  const s = state.specs;
  const deliverables = Number.parseInt(s.deliverablesCount, 10);
  const specs: DesignTicketSpecs = {
    ...(s.platform.trim() && { platform: s.platform.trim() }),
    ...(s.dimensions.trim() && { dimensions: s.dimensions.trim() }),
    ...(s.orientation && { orientation: s.orientation }),
    ...(s.fileFormat.trim() && { fileFormat: s.fileFormat.trim() }),
    ...(Number.isFinite(deliverables) &&
      deliverables > 0 && { deliverablesCount: deliverables }),
  };
  return Object.keys(specs).length > 0 ? specs : undefined;
}

function buildPayload(state: FormState) {
  return {
    brandId: state.brandId,
    requestType: state.requestType,
    title: state.title.trim() || null,
    brief: state.brief,
    dueDate: state.dueDate || null,
    priority: state.priority,
    specs: cleanedSpecs(state) ?? null,
    attachments: state.attachments.map((a) =>
      a.category === "reference" && state.referenceNote.trim()
        ? { ...a, note: a.note ?? state.referenceNote.trim() }
        : a,
    ),
  };
}

export function RequestFormClient({
  brands,
  defaultBrandId,
  initialDraft,
}: {
  brands: BrandOption[];
  defaultBrandId: string;
  initialDraft: InitialDraft | null;
}) {
  const [state, setState] = useState<FormState>(
    initialDraft?.state ?? emptyState(defaultBrandId),
  );
  const [draftId, setDraftId] = useState<string | null>(
    initialDraft?.id ?? null,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [improving, setImproving] = useState(false);
  const [briefBeforeImprove, setBriefBeforeImprove] = useState<string | null>(
    null,
  );
  const [submitted, setSubmitted] = useState<SubmittedTicket | null>(null);

  const isEditingDraft = initialDraft !== null;
  // Persisting must wait for the restore pass: the save effect otherwise fires
  // on mount with the empty initial state and wipes the stored draft before
  // restore reads it.
  const [hydrated, setHydrated] = useState(isEditingDraft);

  // Crash-safety net on top of DB drafts: restore only when not editing a
  // saved draft (the server copy is authoritative there).
  useEffect(() => {
    if (isEditingDraft) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<FormState>;
        setState((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // Ignore parse errors
    }
    setHydrated(true);
  }, [isEditingDraft]);

  useEffect(() => {
    if (!hydrated || isEditingDraft || submitted) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage errors
    }
  }, [state, hydrated, isEditingDraft, submitted]);

  function patch(p: Partial<FormState>) {
    setState((prev) => ({ ...prev, ...p }));
  }

  function patchSpecs(p: Partial<FormState["specs"]>) {
    setState((prev) => ({ ...prev, specs: { ...prev.specs, ...p } }));
  }

  const fileCount = state.attachments.filter((a) => a.kind === "file").length;

  function uploaderProps(category: "asset" | "reference") {
    return {
      brandId: state.brandId,
      category,
      attachments: state.attachments.filter((a) => a.category === category),
      remainingFileSlots: MAX_UPLOAD_FILES - fileCount,
      onAdd: (items: AttachmentInput[]) =>
        patch({ attachments: [...state.attachments, ...items] }),
      onRemove: (index: number) => {
        const inCategory = state.attachments.filter(
          (a) => a.category === category,
        );
        const target = inCategory[index];
        patch({
          attachments: state.attachments.filter((a) => a !== target),
        });
      },
    };
  }

  async function improveWithAi() {
    setImproving(true);
    setError(null);
    try {
      const res = await fetch("/api/design-tickets/improve-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: state.brandId,
          requestType: state.requestType,
          title: state.title.trim() || undefined,
          brief: state.brief,
          specs: cleanedSpecs(state) ?? null,
        }),
      });
      const data = (await res.json()) as { brief: string } | { error: string };
      if (!res.ok || !("brief" in data)) {
        setError(
          ("error" in data && data.error) || "Could not improve the brief.",
        );
        return;
      }
      setBriefBeforeImprove(state.brief);
      patch({ brief: data.brief });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setImproving(false);
    }
  }

  async function persist(mode: "draft" | "submit") {
    const payload = buildPayload(state);

    if (mode === "submit") {
      const parsed = formRequestSchema.safeParse({
        ...payload,
        title: state.title,
        dueDate: state.dueDate || undefined,
        specs: cleanedSpecs(state),
      });
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? "form");
          if (!errors[key]) errors[key] = issue.message;
        }
        setFieldErrors(errors);
        setError("Fix the highlighted fields and try again.");
        return;
      }
      setFieldErrors({});
    } else if (!state.title.trim() && !state.brief.trim()) {
      setError("Add a title or brief before saving a draft.");
      return;
    }

    const setBusy = mode === "submit" ? setSubmitting : setSavingDraft;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const url = draftId
        ? `/api/design-tickets/${draftId}`
        : "/api/design-tickets";
      const res = await fetch(url, {
        method: draftId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          draftId
            ? { ...payload, submit: mode === "submit" }
            : { ...payload, saveAsDraft: mode === "draft" },
        ),
      });
      const data = (await res.json()) as
        | { ticket: { id: string; ticketNumber: number } }
        | { error: string };
      if (!res.ok || !("ticket" in data)) {
        setError(
          ("error" in data && data.error) ||
            "Could not save your request. Please try again.",
        );
        return;
      }
      if (mode === "draft") {
        setDraftId(data.ticket.id);
        setNotice("Draft saved. You can finish and submit any time.");
      } else {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Ignore storage errors
        }
        setSubmitted({
          id: data.ticket.id,
          ticketNumber: data.ticket.ticketNumber,
          priority: state.priority,
        });
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-[var(--border)] bg-surface-1 px-6 py-14 text-center">
        <CheckCircle2 size={40} className="text-success" />
        <div className="space-y-1">
          <h2 className="font-display text-[22px] font-bold text-foreground">
            Request {formatTicketNumber(submitted.ticketNumber)} submitted
          </h2>
          <p className="text-[14px] text-[var(--text-secondary)]">
            Your design request is with the creative team.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          <TicketStatusBadge status="submitted" />
          <span className="text-[var(--text-secondary)]">
            Estimated response time: {priorityEta(submitted.priority)}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Link href={`/design-request/${submitted.id}`}>
            <Button variant="default" size="lg">
              View Request
            </Button>
          </Link>
          <Link href="/design-request">
            <Button variant="outline" size="lg">
              Return to Design Requests
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void persist("submit");
      }}
    >
      <section className={sectionCls}>
        <h2 className="text-[15px] font-bold text-foreground">Request Type</h2>
        <div>
          <label className={labelCls} htmlFor="request-type">
            What do you need designed?
          </label>
          <select
            id="request-type"
            className={inputCls}
            value={state.requestType}
            onChange={(e) => patch({ requestType: e.target.value })}
          >
            {DESIGN_TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className={sectionCls}>
        <h2 className="text-[15px] font-bold text-foreground">
          Project Information
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={labelCls} htmlFor="project-title">
              Project Title
            </label>
            <input
              id="project-title"
              className={inputCls}
              placeholder="e.g. August product launch flyer"
              value={state.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
            {fieldErrors.title && (
              <p className="mt-1 text-[12px] text-[var(--status-error-fg)]">
                {fieldErrors.title}
              </p>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="brand">
              Brand
            </label>
            <select
              id="brand"
              className={inputCls}
              value={state.brandId}
              onChange={(e) => patch({ brandId: e.target.value })}
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="due-date">
              Due Date
            </label>
            <input
              id="due-date"
              className={inputCls}
              type="date"
              value={state.dueDate}
              onChange={(e) => patch({ dueDate: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="priority">
              Priority
            </label>
            <select
              id="priority"
              className={inputCls}
              value={state.priority}
              onChange={(e) =>
                patch({ priority: e.target.value as TicketPriority })
              }
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanizePriority(p)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className={sectionCls}>
        <div className="space-y-1">
          <h2 className="text-[15px] font-bold text-foreground">
            Design Brief
          </h2>
          <p className="text-[13px] text-[var(--text-secondary)]">
            Type or paste your design brief below. Include all the details you
            want our creative team to know, such as your objective, target
            audience, required text, preferred style, colors, references,
            dimensions, platform, and any additional instructions.
          </p>
        </div>
        <textarea
          id="design-brief"
          className={cn(inputCls, "min-h-[220px]")}
          placeholder="Type or paste your design brief here..."
          value={state.brief}
          onChange={(e) => patch({ brief: e.target.value })}
        />
        {fieldErrors.brief && (
          <p className="-mt-2 text-[12px] text-[var(--status-error-fg)]">
            {fieldErrors.brief}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => void improveWithAi()}
            loading={improving}
            loadingText="Improving…"
            disabled={state.brief.trim().length < 20}
          >
            <Sparkles size={14} /> Improve with AI
          </Button>
          {briefBeforeImprove !== null && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                patch({ brief: briefBeforeImprove });
                setBriefBeforeImprove(null);
              }}
            >
              <Undo2 size={14} /> Undo
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => void persist("draft")}
            loading={savingDraft}
            loadingText="Saving…"
          >
            Save Draft
          </Button>
        </div>
      </section>

      <section className={sectionCls}>
        <div className="space-y-1">
          <h2 className="text-[15px] font-bold text-foreground">
            Upload Files{" "}
            <span className="font-normal text-[var(--text-muted)]">
              (optional)
            </span>
          </h2>
          <p className="text-[13px] text-[var(--text-secondary)]">
            Add logos, copy documents, brand guidelines, videos, or anything
            else the team should work with. You can also paste links from Google
            Drive, Dropbox, or Figma.
          </p>
        </div>
        <AttachmentUploader {...uploaderProps("asset")} />
      </section>

      <section className={sectionCls}>
        <div className="space-y-1">
          <h2 className="text-[15px] font-bold text-foreground">
            Design References{" "}
            <span className="font-normal text-[var(--text-muted)]">
              (optional)
            </span>
          </h2>
          <p className="text-[13px] text-[var(--text-secondary)]">
            Upload inspiration images or paste links to designs you like.
          </p>
        </div>
        <AttachmentUploader
          {...uploaderProps("reference")}
          linkPlaceholder="Paste a link to a design you like"
        />
        <div>
          <label className={labelCls} htmlFor="reference-note">
            What do you like about these references?
          </label>
          <textarea
            id="reference-note"
            className={cn(inputCls, "min-h-[70px]")}
            value={state.referenceNote}
            onChange={(e) => patch({ referenceNote: e.target.value })}
          />
        </div>
      </section>

      <section className={sectionCls}>
        <h2 className="text-[15px] font-bold text-foreground">
          Design Specifications{" "}
          <span className="font-normal text-[var(--text-muted)]">
            (optional)
          </span>
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="spec-platform">
              Platform
            </label>
            <input
              id="spec-platform"
              className={inputCls}
              placeholder="e.g. Instagram, print"
              value={state.specs.platform}
              onChange={(e) => patchSpecs({ platform: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="spec-dimensions">
              Dimensions
            </label>
            <input
              id="spec-dimensions"
              className={inputCls}
              placeholder="e.g. 1080x1350"
              value={state.specs.dimensions}
              onChange={(e) => patchSpecs({ dimensions: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="spec-orientation">
              Orientation
            </label>
            <select
              id="spec-orientation"
              className={inputCls}
              value={state.specs.orientation}
              onChange={(e) =>
                patchSpecs({
                  orientation: e.target
                    .value as FormState["specs"]["orientation"],
                })
              }
            >
              <option value="">Not specified</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
              <option value="square">Square</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="spec-format">
              File Format
            </label>
            <input
              id="spec-format"
              className={inputCls}
              placeholder="e.g. PNG, PDF, MP4"
              value={state.specs.fileFormat}
              onChange={(e) => patchSpecs({ fileFormat: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="spec-deliverables">
              Number of Deliverables
            </label>
            <input
              id="spec-deliverables"
              className={inputCls}
              type="number"
              min={1}
              max={50}
              value={state.specs.deliverablesCount}
              onChange={(e) =>
                patchSpecs({ deliverablesCount: e.target.value })
              }
            />
          </div>
        </div>
      </section>

      {error && (
        <p className="rounded-lg bg-[var(--status-error-bg)] px-3 py-2 text-[13px] text-[var(--status-error-fg)]">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg bg-[var(--status-ready-bg)] px-3 py-2 text-[13px] text-[var(--status-ready-fg)]">
          {notice}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          variant="default"
          size="lg"
          loading={submitting}
          loadingText="Submitting…"
        >
          Submit Request
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => void persist("draft")}
          loading={savingDraft}
          loadingText="Saving…"
        >
          Save Draft
        </Button>
      </div>
    </form>
  );
}
