import { resolveWindow } from "@/lib/admin/scope";
import type { AdminScope, UsageKind } from "@/lib/admin/scope-params";
import type { TicketStatus } from "@/lib/design/tickets-ui";

/**
 * What the analytics filter bar resolves to.
 *
 * Every card, the chart and both breakdowns read this one object. Before it,
 * each number carried its own hardcoded window — Generations 7 days, Active
 * brands 30, Time to approval 12 weeks — so "all cards update to match the
 * selected range" could not be true of a page where the ranges were baked into
 * the JSX.
 *
 * Pure: it turns a scope into dates and lists, and nothing here touches a
 * database or a React tree.
 */
export interface AnalyticsFilter {
  /** Inclusive lower bound; null means "everything ever". */
  from: Date | null;
  /** EXCLUSIVE upper bound; null means "up to now". */
  to: Date | null;
  kinds: readonly UsageKind[];
  statuses: readonly TicketStatus[];
  brandId: string | null;
  /** The window's length, for the like-for-like comparison period. */
  periodDays: number;
}

const DAY_MS = 86_400_000;

/** How many whole days a resolved window spans, floored at 1. */
export function windowDays(
  from: Date | null,
  to: Date | null,
  now: Date,
): number {
  if (!from) return 0;
  const end = to ?? now;
  return Math.max(1, Math.round((end.getTime() - from.getTime()) / DAY_MS));
}

export function analyticsFilterFrom(
  scope: AdminScope,
  now: Date,
): AnalyticsFilter {
  const { from, to } = resolveWindow({
    range: scope.range,
    from: scope.from,
    to: scope.to,
    now,
  });
  return {
    from,
    to,
    kinds: scope.kind,
    statuses: scope.status,
    brandId: scope.brand || null,
    periodDays: windowDays(from, to, now),
  };
}

/**
 * The window immediately before this one, same length.
 *
 * A percentage change is only honest against a like-for-like period: comparing
 * a 30-day selection to the previous 7 days would report growth that is an
 * artefact of the window. Returns null for an unbounded range, where there is
 * no previous period to speak of.
 */
export function previousWindow(
  filter: AnalyticsFilter,
  now: Date,
): { from: Date; to: Date } | null {
  if (!filter.from) return null;
  const end = filter.to ?? now;
  const span = end.getTime() - filter.from.getTime();
  if (span <= 0) return null;
  return {
    from: new Date(filter.from.getTime() - span),
    to: filter.from,
  };
}

/** The window in the operator's words, for a card caption. */
export function describeWindow(filter: AnalyticsFilter): string {
  if (!filter.from) return "all time";
  const days = filter.periodDays;
  if (days === 1) return "last 24 hours";
  return `last ${days} days`;
}
