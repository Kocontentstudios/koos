"use client";

import { Check, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatTicketNumber } from "@/lib/design/ticket";
import { defaultDueDate, isCarouselType } from "@/lib/design/tickets-ui";
import { isValidEmail } from "@/lib/validation/email";
import type { BrandSummary, CalendarItem } from "./types";

/** Design-type options from the static template (design-request.html). */
const DESIGN_TYPE_OPTIONS = [
  "Instagram Carousel (1080x1080 per slide)",
  "Instagram Post (1080x1080)",
  "Instagram Story (1080x1920)",
  "Instagram Reel Cover (1080x1920)",
  "X/Twitter Post (1200x675)",
  "LinkedIn Post (1200x627)",
  "Blog Header (1200x630)",
  "Email Header (600x200)",
  "Banner Ad",
  "Other",
];

interface RequestDesignModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: CalendarItem | null;
  brand: BrandSummary | null;
  campaignName: string | null;
}

interface CreatedTicket {
  ticketNumber: number;
  designType: string;
  slides: number | null;
  dueDate: string | null;
}

function formatDueDate(iso: string | null): string {
  if (!iso) return "No due date";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** A top-bordered section heading, matching the template's `.section-label`. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-[var(--divider)] pt-4 text-[14px] font-semibold text-foreground">
      {children}
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="inline-block h-6 w-6 rounded-full ring-1 ring-[var(--border)]"
        style={{ backgroundColor: color }}
      />
      <span className="text-[13px] text-[var(--text-secondary)]">
        {label}: {color}
      </span>
    </div>
  );
}

/** One labeled row of the confirmation summary table. */
function SummaryRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={
        last
          ? "flex items-center justify-between gap-4 py-2"
          : "flex items-center justify-between gap-4 border-b border-[var(--divider)] py-2"
      }
    >
      <span className="text-[12px] text-[var(--text-muted)]">{label}</span>
      <span className="text-right text-[13px] font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}

export function RequestDesignModal({
  open,
  onOpenChange,
  item,
  brand,
  campaignName,
}: RequestDesignModalProps) {
  const router = useRouter();

  const [designType, setDesignType] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [slides, setSlides] = useState("");
  const [brief, setBrief] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [deliveryEmail, setDeliveryEmail] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedTicket | null>(null);

  // Prefill the form whenever a new item opens the modal.
  useEffect(() => {
    if (!open || !item) return;
    setDesignType(item.designType ?? "");
    setDimensions(item.dimensions ?? "");
    setSlides("");
    setBrief(item.brief ?? "");
    setNotes("");
    setDueDate(defaultDueDate(item.date));
    setDeliveryEmail("");
    setError(null);
    setCreated(null);
    setSubmitting(false);
  }, [open, item]);

  async function handleSubmit() {
    if (!item || !brand || submitting) return;
    setSubmitting(true);
    setError(null);
    const trimmedDeliveryEmail = deliveryEmail.trim();
    if (trimmedDeliveryEmail && !isValidEmail(trimmedDeliveryEmail)) {
      setSubmitting(false);
      setError("Enter a valid email address, or leave it blank.");
      return;
    }
    try {
      const res = await fetch("/api/design-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: brand.id,
          calendarItemId: item.id,
          designType: designType.trim(),
          dimensions: dimensions.trim() || null,
          slides: isCarouselType(designType) && slides ? Number(slides) : null,
          brief: brief.trim() || item.title,
          notes: notes.trim() || null,
          deliveryEmail: trimmedDeliveryEmail || null,
          dueDate: dueDate
            ? new Date(`${dueDate}T00:00:00Z`).toISOString()
            : null,
        }),
      });
      const data = (await res.json()) as
        | { ticket: CreatedTicket }
        | { error: string };
      if (!res.ok || !("ticket" in data)) {
        const msg =
          ("error" in data && data.error) ||
          "Could not submit your request. Please try again.";
        setError(msg);
        toast.error(msg);
        return;
      }
      setCreated(data.ticket);
      toast.success("Design request submitted");
      // Reflect the new "submitted" state on the calendar item.
      router.refresh();
    } catch {
      const msg = "Network error. Please try again.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const submitDisabled = submitting || designType.trim().length === 0;
  const showSlides = isCarouselType(designType);

  // Keep a prefilled value selectable even if it isn't a standard option.
  const typeOptions =
    designType && !DESIGN_TYPE_OPTIONS.includes(designType)
      ? [designType, ...DESIGN_TYPE_OPTIONS]
      : DESIGN_TYPE_OPTIONS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-y-auto sm:max-h-[90vh] sm:max-w-lg max-sm:inset-0 max-sm:h-full max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none">
        {created ? (
          // ── Confirmation screen (§5.9) ───────────────────────────────
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <div
              aria-hidden="true"
              className="flex h-16 w-16 items-center justify-center rounded-full"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--status-ready-fg) 15%, transparent)",
              }}
            >
              <Check
                className="h-7 w-7"
                style={{ color: "var(--status-ready-fg)" }}
              />
            </div>
            <div className="space-y-1">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Design request submitted
              </h2>
              <p className="max-w-sm text-sm text-[var(--text-secondary)]">
                Your request has been sent to the KO design team. You will
                receive a notification when your design is ready.
              </p>
            </div>

            <div className="w-full rounded-xl border border-[var(--border)] bg-surface-1 p-5 text-left">
              <SummaryRow
                label="Ticket ID"
                value={formatTicketNumber(created.ticketNumber)}
              />
              <SummaryRow
                label="Design Type"
                value={`${created.designType}${
                  created.slides ? ` — ${created.slides} slides` : ""
                }`}
              />
              <SummaryRow
                label="Due By"
                value={formatDueDate(created.dueDate)}
              />
              <SummaryRow label="Campaign" value={campaignName ?? "—"} last />
            </div>

            <div className="flex w-full flex-col gap-3">
              <Button
                variant="default"
                size="lg"
                className="w-full"
                onClick={() => onOpenChange(false)}
              >
                Back to Calendar
              </Button>
              <Link href="/design-request" className="w-full">
                <Button variant="secondary" size="lg" className="w-full">
                  View My Tickets
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          // ── Request form (§5.8) ──────────────────────────────────────
          <>
            <DialogHeader className="pr-8">
              <DialogTitle className="text-xl">Request Design</DialogTitle>
              <DialogDescription>
                A KO designer will create this for you. Expected delivery: 24–48
                hours.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 flex flex-col gap-4">
              {/* Read-only context — stacked full-width per template */}
              <div className="space-y-1">
                <Label className="text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
                  Campaign
                </Label>
                <p className="inline-flex rounded-md bg-surface-1 px-2.5 py-1 text-[13px] text-[var(--text-secondary)]">
                  {campaignName ?? "—"}
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
                  Content
                </Label>
                <p className="text-[13px] text-[var(--text-secondary)]">
                  {item?.title ?? "—"}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rd-type">
                  Design Type <span className="text-primary">*</span>
                </Label>
                <Select
                  value={designType}
                  onValueChange={(v) => setDesignType((v as string) ?? "")}
                  disabled={submitting}
                >
                  <SelectTrigger id="rd-type" className="w-full">
                    <SelectValue placeholder="Select design type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {showSlides && (
                <div className="space-y-1.5">
                  <Label htmlFor="rd-slides">Number of Slides</Label>
                  <Input
                    id="rd-slides"
                    type="number"
                    min={2}
                    max={10}
                    value={slides}
                    disabled={submitting}
                    onChange={(e) => setSlides(e.target.value)}
                    placeholder="2–10"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="rd-brief">Design Brief</Label>
                <Textarea
                  id="rd-brief"
                  value={brief}
                  disabled={submitting}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="Describe what you need..."
                  className="min-h-[100px]"
                />
              </div>

              {/* Brand assets */}
              {brand && (
                <div className="space-y-3">
                  <SectionLabel>Your Brand Assets</SectionLabel>
                  <div className="flex items-center gap-3">
                    {brand.logoUrl ? (
                      // biome-ignore lint/performance/noImgElement: arbitrary external/R2 logo URL, not optimizable by next/image
                      <img
                        src={brand.logoUrl}
                        alt={`${brand.name} logo`}
                        className="h-16 w-16 rounded-lg object-contain ring-1 ring-[var(--border)]"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-[11px] text-[var(--text-muted)]">
                        No logo
                      </div>
                    )}
                    <Link
                      href="/brand"
                      className="text-[13px] text-primary hover:underline"
                    >
                      Replace in Brand Settings
                    </Link>
                  </div>
                  <div className="flex flex-wrap gap-4 pt-1">
                    {brand.primaryColor && (
                      <Swatch color={brand.primaryColor} label="Primary" />
                    )}
                    {brand.secondaryColor && (
                      <Swatch color={brand.secondaryColor} label="Secondary" />
                    )}
                  </div>
                </div>
              )}

              <SectionLabel>Extra Notes</SectionLabel>
              <div className="space-y-1.5">
                <Textarea
                  id="rd-notes"
                  value={notes}
                  disabled={submitting}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any specific direction for the designer? Reference images, style preferences, things to avoid..."
                  className="min-h-[80px]"
                />
              </div>

              {/* Reference images dropzone — presentational only.
                  NOTE: needs wiring (file input + upload handler + API field). */}
              <div className="space-y-1.5">
                <Label htmlFor="rd-refs">Reference Images (Optional)</Label>
                <div
                  id="rd-refs"
                  className="flex flex-col items-center justify-center rounded-[10px] border-2 border-dashed border-[var(--border)] bg-surface-1 px-6 py-6 text-center"
                >
                  <UploadCloud
                    aria-hidden="true"
                    className="mb-1.5 size-5 text-[var(--text-muted)]"
                  />
                  <p className="text-[13px] text-[var(--text-secondary)]">
                    Click to upload or drag and drop
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    PNG, JPG, GIF up to 5MB each (max 3)
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rd-due">Due Date (Optional)</Label>
                <Input
                  id="rd-due"
                  type="date"
                  value={dueDate}
                  disabled={submitting}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rd-delivery-email">
                  Receive updates &amp; final design at (Optional)
                </Label>
                <Input
                  id="rd-delivery-email"
                  type="email"
                  value={deliveryEmail}
                  disabled={submitting}
                  onChange={(e) => setDeliveryEmail(e.target.value)}
                  placeholder="you@company.com"
                />
                <p className="text-[11px] text-[var(--text-muted)]">
                  Leave blank to use your account email.
                </p>
              </div>

              {error && (
                <p
                  role="alert"
                  className="text-[13px] text-[var(--status-error-fg)]"
                >
                  {error}
                </p>
              )}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
              <DialogClose
                render={<Button variant="secondary" size="lg" />}
                disabled={submitting}
              >
                Cancel
              </DialogClose>
              <Button
                variant="default"
                size="lg"
                loading={submitting}
                loadingText="Submitting…"
                disabled={submitDisabled}
                onClick={handleSubmit}
              >
                Submit Request
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
