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
  tickets: "Design requests",
  approvals: "Time to approval",
  campaigns: "Campaigns created",
  calendar: "Calendar activity",
  deliveries: "Approval rate",
  revisions: "Revision requests",
  brand_setup: "Brand setup completion",
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
  campaigns:
    "Campaigns — strategies — created in this window. The product has no separate campaign entity.",
  calendar:
    "Calendar entries created in this window, with how each was authored and where it got to.",
  deliveries:
    "Every ticket handed over in this window and whether the client signed it off — the population behind the rate.",
  revisions:
    "Each time a client sent work back. A ticket revised three times appears three times.",
  brand_setup: "Brands created in this window and how far their setup got.",
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

/**
 * Which of the three narrowing filters each metric can actually honour.
 *
 * One table, because the header says both "narrowed to X" and "Y does not
 * apply" and those two sentences were derived independently — a metric could
 * be described as narrowed by a filter the query never applied. Every entry
 * here mirrors exactly one condition builder in queries/analytics.ts.
 */
export const METRIC_FILTERS: Record<
  RecordKind,
  { brand: boolean; status: boolean; kind: boolean }
> = {
  generations: { brand: true, status: false, kind: true },
  brands: { brand: true, status: false, kind: true },
  /* A signup belongs to no brand and has no ticket status. */
  users: { brand: false, status: false, kind: false },
  tickets: { brand: true, status: true, kind: false },
  approvals: { brand: true, status: true, kind: false },
  campaigns: { brand: true, status: false, kind: false },
  calendar: { brand: true, status: false, kind: false },
  /* Status is deliberately NOT applied: the ticket status IS the outcome this
     rate measures, so filtering by it would move the numerator and the
     denominator together and pin the rate at 100% or 0%. */
  deliveries: { brand: true, status: false, kind: false },
  revisions: { brand: true, status: false, kind: false },
  brand_setup: { brand: true, status: false, kind: false },
};
