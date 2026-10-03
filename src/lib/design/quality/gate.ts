import type { DesignCheckResult, DesignFault, DesignFaultCode } from "./checks";

/**
 * What to do about a design that failed its checks.
 *
 * One correction pass, not a loop: a loop can spin indefinitely on a brief
 * that cannot be satisfied, and every turn costs the user a wait and an image.
 * One pass is bounded, predictable, and catches the failure that is actually
 * common — a plate that came back empty.
 */

/**
 * Faults a fresh render could plausibly fix.
 *
 * A blank frame or unreadable bytes mean the image model refused or returned
 * nothing, and the next roll is a different image. That is the transient
 * failure worth one more try.
 *
 * Two are excluded deliberately:
 *   - The wrong shape: adapters substitute aspect ratios deterministically —
 *     Google serves 3:4 where 4:5 was asked for, every time — so a re-roll
 *     buys nothing and costs another wait.
 *   - An unreadable logo: it is measured from the mark's own geometry and
 *     contrast, and the product already has a considered answer for it — keep
 *     the design and tell the user which mark to replace (see the logo-fault
 *     notifications in run-design-generation). Re-rolling would double the
 *     cost of every such design without changing the mark.
 */
const RETRYABLE: ReadonlySet<DesignFaultCode> = new Set([
  "blank-frame",
  "unreadable-image",
]);

export function isRetryable(failures: DesignFault[]): boolean {
  return failures.some((fault) => RETRYABLE.has(fault.code));
}

/**
 * Which of two attempts to keep. Ties go to the first: swapping for an equally
 * bad second attempt spends the correction and changes what the user sees for
 * no gain.
 */
export function betterResult(
  first: DesignCheckResult,
  second: DesignCheckResult,
): "first" | "second" {
  if (first.ok) return "first";
  if (second.ok) return "second";
  return second.failures.length < first.failures.length ? "second" : "first";
}

/** The faults in words, for the user-facing notification and the log. */
export function faultSummary(failures: DesignFault[]): string {
  return failures.map((fault) => fault.detail).join(" ");
}
