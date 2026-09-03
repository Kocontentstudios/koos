import type { TicketStatus } from "@/lib/design/tickets-ui";

/**
 * The admin drill-down vocabulary: what a number on the dashboard means when
 * you click it.
 *
 * Pure on purpose. The ticket language ("Delivered", "Approved", "Awaiting
 * Review") does not match the seven-value enum — there is no `approved`
 * status, approval is a nullable timestamp — so the mapping is the risky part
 * and it lives here, as data, testable without a database. `admin-tickets.ts`
 * is the only thing that turns these descriptors into SQL.
 */
export const ADMIN_TICKET_VIEWS = [
  "all",
  "open",
  "active",
  "overdue",
  "draft",
  "submitted",
  "in_progress",
  "needs_revision",
  "awaiting_review",
  "delivered",
  "approved",
  "completed",
  "reopened",
] as const;

export type AdminTicketView = (typeof ADMIN_TICKET_VIEWS)[number];

export interface ViewPredicate {
  statusIn?: readonly TicketStatus[];
  statusNotIn?: readonly TicketStatus[];
  /** `only` = signed off, `none` = never signed off, absent = don't care. */
  approved?: "only" | "none";
  overdue?: true;
}

/* `delivered` means the files are with the client; `approved` means the client
   signed off. They are different sets and diverge on any correction round:
   recordDeliverableVersion sets ready_for_review on every upload and never
   clears approvedAt. */
const APPROVED: ViewPredicate = { statusIn: ["delivered"] };

export const VIEW_PREDICATES: Record<AdminTicketView, ViewPredicate> = {
  all: {},
  open: { statusNotIn: ["draft", "delivered"] },
  active: { statusIn: ["assigned", "in_progress", "ready_for_review"] },
  overdue: {
    statusNotIn: ["draft", "delivered"],
    approved: "none",
    overdue: true,
  },
  draft: { statusIn: ["draft"] },
  submitted: { statusIn: ["submitted"] },
  in_progress: { statusIn: ["assigned", "in_progress"] },
  needs_revision: { statusIn: ["revision_requested"] },
  awaiting_review: { statusIn: ["ready_for_review"], approved: "none" },
  delivered: { statusIn: ["ready_for_review", "delivered"] },
  approved: APPROVED,
  completed: APPROVED,
  reopened: { statusNotIn: ["delivered"], approved: "only" },
};

export interface ViewableTicket {
  status: TicketStatus;
  approvedAt: Date | null;
  dueDate: Date | null;
}

/** The predicate evaluated in JS. The SQL translator must agree with this. */
export function matchesView(
  row: ViewableTicket,
  view: AdminTicketView,
  now: Date,
): boolean {
  const p = VIEW_PREDICATES[view];
  if (p.statusIn && !p.statusIn.includes(row.status)) return false;
  if (p.statusNotIn?.includes(row.status)) return false;
  if (p.approved === "only" && row.approvedAt === null) return false;
  if (p.approved === "none" && row.approvedAt !== null) return false;
  if (p.overdue && overdueMs(row.dueDate, now) === null) return false;
  return true;
}

export function overdueMs(dueDate: Date | null, now: Date): number | null {
  if (!dueDate) return null;
  const ms = now.getTime() - dueDate.getTime();
  return ms > 0 ? ms : null;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Lateness the way an operator says it, not a duration library's answer. */
export function formatOverdue(ms: number): string {
  if (ms >= DAY) {
    const days = Math.floor(ms / DAY);
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (ms >= HOUR) {
    const hours = Math.floor(ms / HOUR);
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return "just now";
}

/* Approved and awaiting-review work belongs on Delivered Projects; everything
   else is a plain status filter on the ticket list. */
export function statusRowHref(status: TicketStatus): string {
  if (status === "delivered") return "/admin/delivered?view=approved";
  if (status === "ready_for_review")
    return "/admin/delivered?view=awaiting_review";
  return `/admin/tickets?status=${status}`;
}

export const ADMIN_RANGES = [
  "7d",
  "15d",
  "30d",
  "90d",
  "all",
  "custom",
] as const;
export type AdminRange = (typeof ADMIN_RANGES)[number];

const PRESET_DAYS: Record<string, number> = {
  "7d": 7,
  "15d": 15,
  "30d": 30,
  "90d": 90,
};

/**
 * Resolves a range to explicit UTC boundaries.
 *
 * Takes the custom bounds as STRINGS and never routes them through a local
 * Date: the server renders in its own zone, so building a boundary from a
 * parsed local date puts the window a day out for anyone not on UTC.
 */
export function resolveWindow(args: {
  range: AdminRange;
  from?: string;
  to?: string;
  now: Date;
}): { from: Date | null; to: Date } {
  const { range, from, to, now } = args;
  if (range === "custom") {
    const a = utcDay(from);
    const b = utcDay(to);
    if (a && b) {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      // Exclusive upper bound: a range "to the 25th" includes all of the 25th.
      return { from: lo, to: new Date(hi.getTime() + DAY) };
    }
    return windowOfDays(30, now);
  }
  if (range === "all") return { from: null, to: now };
  return windowOfDays(PRESET_DAYS[range] ?? 30, now);
}

function windowOfDays(days: number, now: Date) {
  return { from: new Date(now.getTime() - days * DAY), to: now };
}

function utcDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface SortSpec {
  field: "createdAt" | "dueDate" | "updatedAt" | "ticketNumber" | "priority";
  direction: "asc" | "desc";
  nulls?: "last";
}

const SORT_FIELDS: Record<string, SortSpec> = {
  created: { field: "createdAt", direction: "desc" },
  updated: { field: "updatedAt", direction: "desc" },
  ticket: { field: "ticketNumber", direction: "desc" },
  priority: { field: "priority", direction: "desc" },
  due: { field: "dueDate", direction: "asc", nulls: "last" },
  /* "Most overdue" is the oldest due date, and a ticket with no due date is
     not the most overdue thing in the list. */
  overdue: { field: "dueDate", direction: "asc", nulls: "last" },
};

const DEFAULT_SORT: SortSpec = { field: "createdAt", direction: "desc" };

/** Whether a `field:dir` string names a sort the query layer will honour. */
export function isSortable(value: string): boolean {
  const [field, direction] = value.split(":");
  if (!field || !(field in SORT_FIELDS)) return false;
  return direction === undefined || direction === "asc" || direction === "desc";
}

export function sortToColumn(value: string): SortSpec {
  const [field, direction] = value.split(":");
  const spec = SORT_FIELDS[field ?? ""];
  if (!spec) return DEFAULT_SORT;
  if (direction !== "asc" && direction !== "desc") return spec;
  // `overdue` and `due` encode their own direction; asking for the other one
  // still means "by due date", so only the plain fields honour the suffix.
  return spec.nulls ? spec : { ...spec, direction };
}

export const MAX_PAGE = 1000;

export function clampPage(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE);
}
