"use client";

import { ChevronDown, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Strategy } from "@/lib/ai/strategy-schema";
import { cn } from "@/lib/utils";

interface StrategyPanelProps {
  strategy: Strategy;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onEdit: () => void;
  onGenerateCalendar: () => void;
  generating: boolean;
  calendarError: string | null;
}

function AccordionSection({
  title,
  defaultOpen = true,
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
        className="flex w-full items-center justify-between py-3 text-left text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
      >
        {title}
        <ChevronDown
          size={14}
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="pb-3 text-sm text-foreground">{children}</div>}
    </div>
  );
}

export function StrategyPanel({
  strategy,
  collapsed,
  onToggleCollapsed,
  onEdit,
  onGenerateCalendar,
  generating,
  calendarError,
}: StrategyPanelProps) {
  if (collapsed) {
    return (
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
    );
  }

  return (
    <aside className="hidden w-[320px] shrink-0 flex-col border-l border-[var(--border)] lg:flex">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h3 className="text-[13px] font-semibold text-foreground">
          Strategy Preview
        </h3>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Collapse strategy panel"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-foreground"
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4">
        <div className="py-3">
          <span className="inline-block rounded-full bg-[var(--accent-glow)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-primary">
            Strategy
          </span>
          <h4 className="mt-2 text-[16px] font-semibold text-foreground">
            {strategy.campaignName}
          </h4>
        </div>

        <AccordionSection title="Objective">
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
                <span className="text-[var(--text-muted)]">
                  ({t.dateRange})
                </span>
                : {t.focus}
              </div>
            ))}
          </div>
        </AccordionSection>
        <AccordionSection title="Themes">
          <div className="space-y-1.5">
            {strategy.themes.map((th) => (
              <div key={th.title}>
                <span className="font-medium">{th.title}</span> —{" "}
                {th.description}
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
      </div>

      {/* Footer */}
      <div className="flex flex-col gap-2 border-t border-[var(--border)] p-4">
        {calendarError && (
          <p className="rounded-lg bg-[var(--status-error-bg)] px-3 py-2 text-[13px] text-[var(--status-error-fg)]">
            {calendarError}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onEdit} className="flex-1">
            Edit
          </Button>
          <Button
            variant="default"
            onClick={onGenerateCalendar}
            disabled={generating}
            className="flex-1"
          >
            {generating ? "Generating…" : "Generate Calendar"}
          </Button>
        </div>
      </div>
    </aside>
  );
}
