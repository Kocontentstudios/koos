import type { AdminScope, RecordKind } from "@/lib/admin/scope-params";
import { adminScopeHref, RECORD_KINDS } from "@/lib/admin/scope-params";

export type { RecordKind };
/* The vocabulary itself lives in scope-params, beside the other URL
   vocabularies — see the note there on why importing it the other way is a
   cycle that fails silently. Re-exported so callers have one import. */
export { RECORD_KINDS };

export const RECORD_LABELS: Record<RecordKind, string> = {
  generations: "Generations",
  brands: "Active brands",
  users: "New users",
  tickets: "Tickets",
  approvals: "Time to approval",
};

/** What each list is made of, said before the table so the columns make sense. */
export const RECORD_DESCRIPTIONS: Record<RecordKind, string> = {
  generations:
    "Every strategy, calendar, design ticket and generated image produced in this window.",
  brands:
    "Brands with at least one generation in this window, most active first.",
  users: "Accounts created in this window.",
  tickets: "Design tickets created in this window.",
  approvals:
    "The approved tickets behind the median — each one's time from request to sign-off.",
};

export function isRecordKind(value: string): value is RecordKind {
  return (RECORD_KINDS as readonly string[]).includes(value);
}

/**
 * Where a metric opens.
 *
 * Carries the WHOLE analytics scope and patches only what the caller names, so
 * a drill-down can never silently drop the filter an operator applied — the
 * requirement FEAT-007 states as "make sure the selected Analytics filters
 * remain applied", and the reason it is a property of this builder rather than
 * a decision each link has to remember.
 */
export function recordsHref(
  scope: AdminScope,
  kind: RecordKind,
  patch: Partial<AdminScope> = {},
): string {
  return adminScopeHref("/admin/analytics/records", scope, {
    ...patch,
    metric: kind,
    page: 1,
  } as Partial<AdminScope>);
}
