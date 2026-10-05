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
 * Faults a fresh render of the SAME spec could plausibly fix.
 *
 * A blank frame or unreadable bytes mean the image model refused or returned
 * nothing, and the next roll is a different image. That is the transient
 * failure worth one more try with nothing changed.
 *
 * The other two are not transient, which is why they are not here — but see
 * CORRECTABLE below: not worth re-rolling is not the same as not worth fixing.
 */
const RETRYABLE: ReadonlySet<DesignFaultCode> = new Set([
  "blank-frame",
  "unreadable-image",
]);

/**
 * Faults a CHANGED spec could plausibly fix.
 *
 * The distinction matters because the judge exists to change the spec, and
 * when the two sets were the same the judge could only ever be handed the two
 * faults with nothing to look at: unreadable bytes contain no image, and a
 * blank frame is a flat rectangle the deterministic check has already
 * described in words. Its vision half was unreachable.
 *
 * An unreadable logo is the case this unlocks. Re-rolling the same spec buys
 * nothing — the mark and its ground are unchanged — but moving the mark to
 * another corner, lifting the colour behind it, or dropping a footer band that
 * swallowed it are all spec changes, and all of them are visible in the
 * rendered pixels the judge can now be shown.
 *
 * The wrong shape stays out. Adapters substitute aspect ratios
 * deterministically — Google serves 3:4 where 4:5 was asked for, every time —
 * so no change to the spec alters what comes back, and spending a judge call
 * on it would buy a verdict nobody can act on.
 */
const CORRECTABLE: ReadonlySet<DesignFaultCode> = new Set([
  "blank-frame",
  "unreadable-image",
  "unreadable-logo",
]);

export function isRetryable(failures: DesignFault[]): boolean {
  return failures.some((fault) => RETRYABLE.has(fault.code));
}

export function isCorrectable(failures: DesignFault[]): boolean {
  return failures.some((fault) => CORRECTABLE.has(fault.code));
}

/**
 * How bad each fault is, worst first. A count alone ranks a blank rectangle
 * and a design with one hard-to-read mark as equally bad, so a correction that
 * turned an empty frame into a real design with an imperfect logo would be
 * discarded and the empty frame delivered. Measured as reachable: a
 * blank-frame first render, a `backgroundPrompt` correction, and a second
 * render carrying only `unreadable-logo`.
 */
const SEVERITY: Record<DesignFaultCode, number> = {
  /* Nothing to look at. */
  "unreadable-image": 4,
  "blank-frame": 3,
  /* Something to look at, in the wrong shape. */
  "wrong-dimensions": 2,
  /* A real design, with one element that does not read. */
  "unreadable-logo": 1,
};

function worstFault(failures: DesignFault[]): number {
  return failures.reduce(
    (worst, fault) => Math.max(worst, SEVERITY[fault.code]),
    0,
  );
}

/**
 * Which of two attempts to keep.
 *
 * The worst fault decides, and only then the count. Ties go to the first:
 * swapping for an equally bad second attempt spends the correction and changes
 * what the user sees for no gain.
 */
export function betterResult(
  first: DesignCheckResult,
  second: DesignCheckResult,
): "first" | "second" {
  if (first.ok) return "first";
  if (second.ok) return "second";

  const firstWorst = worstFault(first.failures);
  const secondWorst = worstFault(second.failures);
  if (secondWorst !== firstWorst) {
    return secondWorst < firstWorst ? "second" : "first";
  }
  return second.failures.length < first.failures.length ? "second" : "first";
}

/** The faults in words, for the user-facing notification and the log. */
export function faultSummary(failures: DesignFault[]): string {
  return failures.map((fault) => fault.detail).join(" ");
}
