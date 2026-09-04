import Link from "next/link";
import { formatPercentChange } from "@/lib/analytics/rollup";

/* Direction is carried by the arrow as well as the colour, so the delta still
   reads correctly to anyone who cannot distinguish the two hues. Both tokens
   are redefined for light mode in globals.css. */
const TONE = {
  up: "var(--status-ready-fg)",
  down: "var(--status-error-fg)",
  flat: "var(--text-muted)",
} as const;

function toneFor(change: number | null): keyof typeof TONE {
  if (change === null || Math.round(change) === 0) return "flat";
  return change > 0 ? "up" : "down";
}

export function StatCard({
  label,
  value,
  change,
  caption,
  href,
}: {
  label: string;
  value: number | string;
  /** Where the number opens. Omitted, the card stays a plain div — not every
   *  figure has records behind it. */
  href?: string;
  /** Percent change vs the previous period. `null` renders as "—" (no
   *  comparable previous period); omit entirely to hide the delta. */
  change?: number | null;
  caption?: string;
}) {
  /* Two token choices, both deliberate:
     --hover, not a surface token, because --surface-1 and --surface-2 are both
     #ffffff in light mode and hover:bg-surface-2 leaves the card with no
     feedback at all — and the feedback IS the feature here.
     --primary for the focus ring. Setting `outline` explicitly suppresses the
     UA default, so this ring IS the indicator and has to clear WCAG 1.4.11's
     3:1. The offset is what decides which ground to measure against: with
     outline-offset the ring sits on --background, NOT on the card. Measured
     there, --border-control is 2.88:1 in light mode (it is tuned against the
     card, where it is 3.26:1) and --border-accent is ~1.7:1 on both. --primary
     is 3.34:1 light / 5.15:1 dark on --background. Change the offset and this
     measurement has to be redone. */
  const className =
    "block rounded-xl border border-[var(--border)] bg-surface-1 p-4" +
    (href
      ? " transition-colors hover:bg-[var(--hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      : "");

  const body = (
    <>
      <p className="text-[12px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="font-display text-2xl font-bold text-foreground">
          {value}
        </p>
        {change !== undefined && (
          <span
            className="text-[13px] font-medium"
            style={{ color: TONE[toneFor(change)] }}
          >
            {formatPercentChange(change)}
          </span>
        )}
      </div>
      {caption && (
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">{caption}</p>
      )}
    </>
  );

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
