"use client";

import { Button } from "@/components/ui/button";
import type { Strategy } from "@/lib/ai/strategy-schema";
import { cn } from "@/lib/utils";

interface StrategyCardProps {
  strategy: Strategy;
  onEdit?: () => void;
  onGenerateCalendar?: () => void;
  generating?: boolean;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] uppercase text-[var(--text-muted)] tracking-wider mb-0.5">
      {children}
    </p>
  );
}

function SectionValue({ children }: { children: React.ReactNode }) {
  return <p className="text-white text-sm">{children}</p>;
}

export function StrategyCard({
  strategy,
  onEdit,
  onGenerateCalendar,
  generating = false,
}: StrategyCardProps) {
  return (
    <div
      className={cn(
        "bg-surface-1 border border-[rgba(19,139,200,0.3)] border-l-[3px] border-l-primary rounded-xl p-5",
      )}
    >
      {/* Badge */}
      <span className="inline-block rounded-full bg-[rgba(19,139,200,0.15)] text-primary text-[11px] px-2 py-0.5 font-medium uppercase tracking-wider mb-3">
        STRATEGY
      </span>

      {/* Campaign Name */}
      <h3 className="text-[18px] font-semibold text-white mb-4">
        {strategy.campaignName}
      </h3>

      <div className="space-y-3">
        {/* Objective */}
        <div>
          <SectionLabel>Objective</SectionLabel>
          <SectionValue>{strategy.objective}</SectionValue>
        </div>

        {/* Target Audience */}
        <div>
          <SectionLabel>Target</SectionLabel>
          <SectionValue>{strategy.targetAudience}</SectionValue>
        </div>

        {/* Key Message */}
        <div>
          <SectionLabel>Key Message</SectionLabel>
          <SectionValue>{strategy.keyMessage}</SectionValue>
        </div>

        {/* Channels */}
        <div>
          <SectionLabel>Channels</SectionLabel>
          <div className="space-y-0.5">
            {strategy.channels.map((ch) => (
              <div key={ch.name} className="text-white text-sm">
                <span>{ch.name}</span>
                {ch.rationale ? (
                  <span className="text-white/70"> — {ch.rationale}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* Content Mix */}
        <div>
          <SectionLabel>Content Mix</SectionLabel>
          <div className="space-y-0.5">
            {strategy.contentMix.map((cm) => (
              <SectionValue key={cm.type}>
                {cm.type} × {cm.count}
              </SectionValue>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div>
          <SectionLabel>Timeline</SectionLabel>
          <div className="space-y-0.5">
            {strategy.timeline.map((t) => (
              <SectionValue key={t.phase}>
                {t.phase} ({t.dateRange}): {t.focus}
              </SectionValue>
            ))}
          </div>
        </div>

        {/* Themes */}
        <div>
          <SectionLabel>Themes</SectionLabel>
          <div className="space-y-0.5">
            {strategy.themes.map((th) => (
              <SectionValue key={th.title}>
                {th.title} — {th.description}
              </SectionValue>
            ))}
          </div>
        </div>

        {/* Posting Schedule */}
        <div>
          <SectionLabel>Posting Schedule</SectionLabel>
          <div className="space-y-0.5">
            {strategy.postingSchedule.map((ps) => (
              <SectionValue key={ps.channel}>
                {ps.channel}: {ps.cadence}
              </SectionValue>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" onClick={onEdit}>
          Edit Strategy
        </Button>
        <Button
          variant="default"
          onClick={onGenerateCalendar}
          disabled={generating}
        >
          {generating ? "Generating…" : "Generate Calendar"}
        </Button>
      </div>
    </div>
  );
}
