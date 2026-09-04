"use client";

import {
  Calendar,
  ChevronDown,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Strategy } from "@/lib/ai/strategy-schema";
import type { JobProgress } from "@/lib/jobs/run-generation";
import { cn } from "@/lib/utils";

interface StrategyPanelProps {
  strategy: Strategy | null;
  /** False while the campaign is still a draft, so the panel offers the same
   * next step the card does instead of quietly committing it. */
  saved?: boolean;
  onSave?: () => void;
  saving?: boolean;
  /** Any card/panel action is in flight; the handlers refuse a second, so the
   * controls must look refused rather than swallowing a live click. */
  busy?: boolean;
  /** Shown instead of the never-drafted copy when the chat HAS a campaign that
   * simply is not loaded into the panel yet. */
  emptyMessage?: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onGenerateCalendar: () => void;
  onEdit: () => void;
  generating: boolean;
  /** Progress label shown on the button while generating (e.g. "week 2 of 4"). */
  generatingLabel?: string;
  /** Reassurance shown under the button on long runs ("you'll be alerted…"). */
  generatingHint?: string | null;
  calendarProgress?: JobProgress | null;
  calendarError: string | null;
  /** Mobile drawer open state (below the lg breakpoint). */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function AccordionSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[var(--divider)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between py-2.5 text-left text-[13px] font-medium text-[var(--text-secondary)]"
      >
        {title}
        <ChevronDown
          size={12}
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="pb-2.5 text-[13px] text-foreground">{children}</div>
      )}
    </div>
  );
}

function PanelBody({
  strategy,
  emptyMessage,
}: {
  strategy: Strategy | null;
  emptyMessage?: string;
}) {
  if (!strategy) {
    return (
      <p className="px-1 py-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">
        {emptyMessage ??
          "Your strategy summary will appear here once KO drafts a plan."}
      </p>
    );
  }
  return (
    <>
      <div className="py-3">
        <span className="inline-block rounded-full bg-[var(--accent-glow)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-primary">
          Strategy
        </span>
        <h4 className="mt-2 text-[16px] font-semibold text-foreground">
          {strategy.campaignName}
        </h4>
      </div>

      <AccordionSection title="Objective" defaultOpen>
        {strategy.objective}
      </AccordionSection>
      <AccordionSection title="Target Audience">
        {strategy.targetAudience}
      </AccordionSection>
      <AccordionSection title="Key Message">
        {strategy.keyMessage}
      </AccordionSection>
      <AccordionSection title="Channels">
        <div className="space-y-1.5">
          {strategy.channels.map((ch) => (
            <div key={ch.name}>
              <span className="font-medium">{ch.name}</span>
              {ch.rationale && (
                <span className="text-[var(--text-secondary)]">
                  {" "}
                  — {ch.rationale}
                </span>
              )}
            </div>
          ))}
        </div>
      </AccordionSection>
      <AccordionSection title="Content Mix">
        <div className="space-y-1">
          {strategy.contentMix.map((cm) => (
            <div key={cm.type}>
              {cm.type} × {cm.count}
            </div>
          ))}
        </div>
      </AccordionSection>
      <AccordionSection title="Timeline">
        <div className="space-y-1.5">
          {strategy.timeline.map((t) => (
            <div key={t.phase}>
              <span className="font-medium">{t.phase}</span>{" "}
              <span className="text-[var(--text-muted)]">({t.dateRange})</span>:{" "}
              {t.focus}
            </div>
          ))}
        </div>
      </AccordionSection>
      <AccordionSection title="Themes">
        <div className="space-y-1.5">
          {strategy.themes.map((th) => (
            <div key={th.title}>
              <span className="font-medium">{th.title}</span> — {th.description}
            </div>
          ))}
        </div>
      </AccordionSection>
      <AccordionSection title="Posting Schedule">
        <div className="space-y-1">
          {strategy.postingSchedule.map((ps) => (
            <div key={ps.channel}>
              {ps.channel}: {ps.cadence}
            </div>
          ))}
        </div>
      </AccordionSection>
    </>
  );
}

/** Shared header + scrollable body + footer, used by both desktop aside and mobile drawer. */
function PanelContent({
  strategy,
  saved,
  onSave,
  saving,
  busy,
  emptyMessage,
  onGenerateCalendar,
  onEdit,
  generating,
  generatingLabel,
  generatingHint,
  calendarProgress,
  calendarError,
  headerAction,
}: {
  strategy: Strategy | null;
  saved: boolean;
  onSave?: () => void;
  saving: boolean;
  busy: boolean;
  emptyMessage?: string;
  onGenerateCalendar: () => void;
  onEdit: () => void;
  generating: boolean;
  generatingLabel?: string;
  generatingHint?: string | null;
  calendarProgress?: JobProgress | null;
  calendarError: string | null;
  headerAction: React.ReactNode;
}) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
        <h3 className="text-[14px] font-semibold text-foreground">
          Strategy Summary
        </h3>
        {headerAction}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        <PanelBody strategy={strategy} emptyMessage={emptyMessage} />
      </div>

      {strategy && (
        <div className="flex flex-col gap-2 border-t border-[var(--border)] p-4">
          {calendarError && (
            <p className="rounded-lg bg-[var(--status-error-bg)] px-3 py-2 text-[13px] text-[var(--status-error-fg)]">
              {calendarError}
            </p>
          )}
          {/* The card's model is draft → Save → Generate Calendar. Offering
              calendar generation here on a draft would contradict it, and the
              generation path commits the draft silently. */}
          {saved ? (
            <Button
              variant="secondary"
              onClick={onGenerateCalendar}
              loading={generating}
              loadingText={generatingLabel ?? "Generating…"}
              disabled={busy}
              className="w-full justify-center"
            >
              <Calendar className="size-4" />
              Generate Calendar
            </Button>
          ) : (
            onSave && (
              <Button
                variant="secondary"
                onClick={onSave}
                loading={saving}
                loadingText="Saving…"
                disabled={busy}
                className="w-full justify-center"
              >
                Save Campaign
              </Button>
            )
          )}
          {/* The server counts the outline as step 1 of total, so briefs are
              total-1 and done-1. During planning that is 0 of 0 and no bar
              shows — a determinate bar parked at zero is a worse lie than a
              spinner, and "0 of 1 briefs written" during a 60s outline is
              worse still. */}
          {generating &&
            calendarProgress &&
            calendarProgress.total > 1 &&
            (() => {
              const done = Math.max(calendarProgress.done - 1, 0);
              const total = calendarProgress.total - 1;
              const label = `${done} of ${total} briefs written`;
              return (
                <div role="status" className="space-y-1.5">
                  <div
                    role="progressbar"
                    aria-valuenow={done}
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-valuetext={label}
                    className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--status-progress-bg)]"
                  >
                    <div
                      className="h-full rounded-full bg-[var(--status-progress-fg)] transition-[width] duration-500"
                      style={{ width: `${Math.round((done / total) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[12px] text-[var(--text-muted)] tabular-nums">
                    {label}
                  </p>
                </div>
              );
            })()}
          {generating && generatingHint && (
            <p
              role="status"
              className="rounded-lg bg-[var(--status-progress-bg)] px-3 py-2 text-[13px] text-[var(--status-progress-fg)]"
            >
              {generatingHint}
            </p>
          )}
          <Button
            variant="secondary"
            onClick={onEdit}
            className="w-full justify-center"
          >
            Edit strategy
          </Button>
        </div>
      )}
    </>
  );
}

export function StrategyPanel({
  strategy,
  saved = true,
  onSave,
  saving = false,
  busy = false,
  emptyMessage,
  collapsed,
  onToggleCollapsed,
  onGenerateCalendar,
  onEdit,
  generating,
  generatingLabel,
  generatingHint,
  calendarProgress,
  calendarError,
  mobileOpen,
  onMobileClose,
}: StrategyPanelProps) {
  return (
    <>
      {/* Desktop: collapsed rail */}
      {collapsed && (
        <aside className="hidden w-12 shrink-0 flex-col items-center border-l border-[var(--border)] py-4 lg:flex">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Expand strategy panel"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
          >
            <PanelRightOpen size={18} />
          </button>
          <span className="mt-4 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)] [writing-mode:vertical-rl]">
            Strategy
          </span>
        </aside>
      )}

      {/* Desktop: expanded panel */}
      {!collapsed && (
        <aside className="hidden w-[320px] shrink-0 flex-col border-l border-[var(--border)] lg:flex">
          <PanelContent
            strategy={strategy}
            saved={saved}
            onSave={onSave}
            saving={saving}
            busy={busy}
            emptyMessage={emptyMessage}
            onGenerateCalendar={onGenerateCalendar}
            onEdit={onEdit}
            generating={generating}
            generatingLabel={generatingLabel}
            generatingHint={generatingHint}
            calendarProgress={calendarProgress}
            calendarError={calendarError}
            headerAction={
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label="Collapse strategy panel"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
              >
                <PanelRightClose size={16} />
              </button>
            }
          />
        </aside>
      )}

      {/* Mobile: right-side drawer */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close strategy summary"
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-[var(--backdrop)] lg:hidden"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-[var(--border)] bg-surface-1 transition-transform duration-200 lg:hidden",
          mobileOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <PanelContent
          strategy={strategy}
          saved={saved}
          onSave={onSave}
          saving={saving}
          busy={busy}
          emptyMessage={emptyMessage}
          onGenerateCalendar={onGenerateCalendar}
          onEdit={onEdit}
          generating={generating}
          generatingLabel={generatingLabel}
          generatingHint={generatingHint}
          calendarProgress={calendarProgress}
          calendarError={calendarError}
          headerAction={
            <button
              type="button"
              onClick={onMobileClose}
              aria-label="Close strategy summary"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
            >
              <X size={16} />
            </button>
          }
        />
      </aside>
    </>
  );
}
