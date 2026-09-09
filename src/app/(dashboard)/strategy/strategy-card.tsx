"use client";

import {
  CalendarPlus,
  Check,
  Eye,
  MessageSquareText,
  Target,
} from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  type CampaignCard,
  campaignChannelLine,
  campaignTimelineLine,
  isCampaignSaved,
} from "@/lib/strategy/campaign-card";

interface StrategyCardProps {
  campaign: CampaignCard;
  onOpen: (strategyId: string) => void;
  onReview: (strategyId: string) => void;
  onSave: (strategyId: string) => void;
  onGenerateCalendar: () => void;
  opening?: boolean;
  saving?: boolean;
  reviewing?: boolean;
  generatingCalendar?: boolean;
  error?: string | null;
}

/** The card's controls need a boundary and a focus ring that actually clear
 * WCAG 1.4.11's 3:1; the secondary variant's border and the --accent-glow ring
 * are both far below it, and this is the first surface carrying three
 * sequential controls, so focus order has to be visible here.
 *
 * The border is an INLINE STYLE, not a `border-[…]` class: globals.css sets
 * `* { border-color: var(--border) }` outside any layer, and unlayered CSS
 * beats @layer utilities, so every border utility on a button silently loses.
 * Inline wins regardless. Assert the computed value, never the class name. */
const CARD_BORDER = { borderColor: "var(--border-control)" } as const;
const CARD_FOCUS =
  "focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]";
const CARD_ACTION = `h-11 sm:h-9 ${CARD_FOCUS}`;

/**
 * The campaign a chat produced, pinned into that chat. Driven by the stored
 * strategies row rather than a message part, because chat_messages holds flat
 * text — a message-part card would not survive reopening the chat.
 */
export function StrategyCard({
  campaign,
  onOpen,
  onReview,
  onSave,
  onGenerateCalendar,
  opening = false,
  saving = false,
  reviewing = false,
  generatingCalendar = false,
  error = null,
}: StrategyCardProps) {
  const saved = isCampaignSaved(campaign);
  const headingId = useId();
  // One card action at a time. The client already refuses a second, so the
  // buttons must look refused rather than swallowing a live-looking click.
  const busy = opening || saving || reviewing || generatingCalendar;
  const channels = campaignChannelLine(campaign);
  const timeline = campaignTimelineLine(campaign);

  return (
    <article
      aria-labelledby={headingId}
      style={{ borderColor: "var(--border-accent)" }}
      /* `relative` is load-bearing: the sr-only status below is
         position:absolute and must be contained by this card. Uncontained, it
         stretched the page from 720px to ~5000px behind a chat that is
         supposed to scroll internally. Pinned by a regression test. */
      className="relative w-full rounded-xl border bg-surface-1 p-4 sm:max-w-[480px]"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-glow)] text-primary">
          <Target size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block rounded-full bg-[var(--accent-glow)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-primary">
              Campaign Strategy
            </span>
            {saved ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--status-ready-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-ready-fg)]">
                <Check className="size-3" />
                Saved
              </span>
            ) : (
              // Absence of a badge is not a signal: without this the user
              // cannot tell the campaign is uncommitted, which makes Save
              // meaningless.
              <span
                style={CARD_BORDER}
                className="inline-block rounded-full border bg-[var(--status-draft-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-draft-fg)]"
              >
                Draft
              </span>
            )}
          </div>
          <h3
            id={headingId}
            title={campaign.campaignName}
            className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug text-foreground"
          >
            {campaign.campaignName}
          </h3>
          <p
            title={campaign.objective}
            className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-[var(--text-secondary)]"
          >
            {campaign.objective}
          </p>
          {/* Two lines, each clamped on its own: sharing one clamped line
              always truncated the timeline span away. Weight, not color,
              separates these from the objective — the muted token is 3.4:1
              in light mode. */}
          {channels && (
            <p
              title={channels}
              className="mt-2 line-clamp-1 text-[11px] font-medium tracking-wide text-[var(--text-secondary)]"
            >
              {channels}
            </p>
          )}
          {timeline && (
            <p
              title={timeline}
              className="line-clamp-1 text-[11px] font-medium tracking-wide text-[var(--text-secondary)]"
            >
              {timeline}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-[var(--status-error-bg)] px-3 py-2 text-[13px] text-[var(--status-error-fg)]"
        >
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2 sm:pl-11">
        <Button
          size="lg"
          variant="secondary"
          className={CARD_ACTION}
          style={CARD_BORDER}
          onClick={() => onOpen(campaign.id)}
          loading={opening}
          loadingText="Opening…"
          disabled={busy}
          aria-label={`Open strategy: ${campaign.campaignName}`}
        >
          <Eye className="size-4" />
          Open
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className={CARD_ACTION}
          style={CARD_BORDER}
          onClick={() => onReview(campaign.id)}
          loading={reviewing}
          loadingText="Adding recap…"
          disabled={busy}
          aria-label={`Review strategy in chat: ${campaign.campaignName}`}
        >
          <MessageSquareText className="size-4" />
          Review
        </Button>
        {/* ONE element across both states. Swapping two keyed buttons unmounts
            the focused one, dropping keyboard focus to the document body right
            after the user presses Save. The announcement is handled by the
            hidden status below instead. */}
        <Button
          size="lg"
          className={`h-11 sm:h-9 ${CARD_FOCUS}`}
          onClick={saved ? onGenerateCalendar : () => onSave(campaign.id)}
          loading={saved ? generatingCalendar : saving}
          disabled={busy}
          loadingText={saved ? "Generating…" : "Saving…"}
          aria-label={
            saved
              ? `Generate Calendar for ${campaign.campaignName}`
              : `Save strategy: ${campaign.campaignName}`
          }
        >
          {saved && <CalendarPlus className="size-4" />}
          {saved ? "Generate Calendar" : "Save"}
        </Button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {saved
          ? `Saved. Generate Calendar is now available for ${campaign.campaignName}.`
          : ""}
      </p>
    </article>
  );
}
