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
  /* --hover, not a surface token: --surface-1 and --surface-2 are both #ffffff
     in light mode, so hover:bg-surface-2 leaves the card with no feedback at
     all — and the feedback IS the feature here. */
  const className =
    "block rounded-xl border border-[var(--border)] bg-surface-1 p-4" +
    (href
      ? " transition-colors hover:bg-[var(--hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-accent)]"
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
