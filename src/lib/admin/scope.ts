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
  "in_progress",
  "needs_revision",
  "awaiting_review",
  "delivered",
  "approved",
] as const;

export type AdminTicketView = (typeof ADMIN_TICKET_VIEWS)[number];

export interface ViewPredicate {
  statusIn?: readonly TicketStatus[];
  statusNotIn?: readonly TicketStatus[];
  /** `none` = never signed off, absent = don't care. */
  approved?: "none";
  overdue?: true;
}

export const VIEW_PREDICATES: Record<AdminTicketView, ViewPredicate> = {
  all: {},
  open: { statusNotIn: ["draft", "delivered"] },
  active: { statusIn: ["assigned", "in_progress", "ready_for_review"] },
  /* No approved_at clause. approvedAt is never cleared (schema.ts), so
     "has ever been approved" is not "is finished": a signed-off ticket sent
     back for a revision with a new due date is live work again. Excluding it
     hid the tickets most likely to have slipped from the one view whose job is
     to surface them. Finished work is already excluded by `delivered`. */
  overdue: { statusNotIn: ["draft", "delivered"], overdue: true },
  in_progress: { statusIn: ["assigned", "in_progress"] },
  needs_revision: { statusIn: ["revision_requested"] },
  /* No approved_at clause, for the same reason `overdue` has none. A
     correction round sets ready_for_review AND notifies the client
     (recordDeliverableVersion), so a re-uploaded ticket genuinely IS awaiting
     review — and approvedAt still carries the FIRST sign-off, which is not a
     statement about the round now in front of them. Gating on it made the card
     under-report exactly the work clients are sitting on, and made the card
     disagree with the status row for one status. */
  awaiting_review: { statusIn: ["ready_for_review"] },
  /* Everything the studio has handed over at least once, whether or not the
     client has answered — the base set of the Delivered Projects page. */
  delivered: { statusIn: ["ready_for_review", "delivered"] },
  /* `delivered` IS the signed-off state — applyClientReview sets the status
     and approvedAt in one statement, and STATUS_LABELS renders it "Approved".
     The view is named for the operator's word, not the enum's. It keys on
     status rather than approvedAt because approvedAt is never cleared: a
     correction round after sign-off moves the ticket OUT of this set while
     keeping the timestamp. */
  approved: { statusIn: ["delivered"] },
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

/**
 * Lateness the way an operator says it, not a duration library's answer.
 *
 * Every caller concatenates " overdue" — the chip, the in-app notification and
 * the reminder email's subject line — so this must read as a DURATION in that
 * sentence. "just now" produced "DT-0012 is just now overdue" in a subject
 * line, which is how every overdue ticket read for its first hour.
 */
export function formatOverdue(ms: number): string {
  if (ms >= DAY) {
    const days = Math.floor(ms / DAY);
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (ms >= HOUR) {
    const hours = Math.floor(ms / HOUR);
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return "less than an hour";
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

type PresetRange = Exclude<AdminRange, "all" | "custom">;

const PRESET_DAYS: Record<PresetRange, number> = {
  "7d": 7,
  "15d": 15,
  "30d": 30,
  "90d": 90,
};

/**
 * Resolves a range to an absolute window.
 *
 * A CUSTOM range snaps to UTC day boundaries; the presets are rolling offsets
 * from `now` and make no claim to a day boundary. Custom bounds are taken as
 * STRINGS and never routed through a local Date: the server renders in its own
 * zone, so parsing "2026-07-19" locally puts the window a day out for anyone
 * not on UTC.
 *
 * `to` is EXCLUSIVE. Callers must compare with `<`, never `<=`, or a range
 * stated "to the 25th" swallows the 26th.
 */
export function resolveWindow(args: {
  range: AdminRange;
  from?: string;
  to?: string;
  now: Date;
}): { from: Date | null; to: Date | null } {
  const { range, from, to, now } = args;
  if (range === "custom") {
    const a = utcDay(from);
    const b = utcDay(to);
    // Half-open input is an answerable question ("since the 19th"), so honour
    // the bound given rather than silently substituting a 30-day window.
    if (a && b) {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return { from: lo, to: endOfUtcDay(hi) };
    }
    if (a) return { from: a, to: now };
    if (b) return { from: null, to: endOfUtcDay(b) };
    return windowOfDays(30, now);
  }
  // Unbounded at BOTH ends: `to: now` would hide every future due date the
  // moment a caller anchored on `due`.
  if (range === "all") return { from: null, to: null };
  return windowOfDays(PRESET_DAYS[range], now);
}

function endOfUtcDay(day: Date): Date {
  return new Date(day.getTime() + DAY);
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
  field:
    | "createdAt"
    | "dueDate"
    | "updatedAt"
    | "ticketNumber"
    | "priority"
    | "deliveredAt"
    | "approvedAt";
  direction: "asc" | "desc";
  /** The sort's meaning fixes its direction, so a `:desc` suffix is ignored. */
  fixedDirection?: true;
}

const SORT_FIELDS: Record<string, SortSpec> = {
  created: { field: "createdAt", direction: "desc" },
  /* Newest delivery first. Delivered Projects is read to answer "what have we
     shipped lately", which creation date answers wrongly: a January ticket
     delivered yesterday belongs above a last-week ticket delivered last week. */
  delivered: { field: "deliveredAt", direction: "desc" },
  approved: { field: "approvedAt", direction: "desc" },
  updated: { field: "updatedAt", direction: "desc" },
  ticket: { field: "ticketNumber", direction: "desc" },
  priority: { field: "priority", direction: "desc" },
  due: { field: "dueDate", direction: "asc", fixedDirection: true },
  /* "Most overdue" is the oldest due date, ascending. Postgres already sorts
     NULLs last on ASC, which is what we want: a ticket with no due date is not
     the most overdue thing in the list. */
  overdue: { field: "dueDate", direction: "asc", fixedDirection: true },
};

const DEFAULT_SORT: SortSpec = { field: "createdAt", direction: "desc" };

/**
 * What a view sorts by when the URL does not say.
 *
 * The working queue is read top-down to decide what to pick up next, so urgent
 * work has to surface without the designer sorting first. An overdue list is
 * read the same way for a different reason: the oldest due date is the most
 * overdue ticket, and that is the one that needs a call today.
 */
const DEFAULT_SORT_KEY: Partial<Record<AdminTicketView, string>> = {
  delivered: "delivered",
  awaiting_review: "delivered",
  approved: "approved",
  open: "priority",
  in_progress: "priority",
  needs_revision: "priority",
  active: "priority",
  overdue: "overdue",
};

export function defaultSortKeyFor(view: AdminTicketView): string {
  return DEFAULT_SORT_KEY[view] ?? "created";
}

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
  return spec.fixedDirection ? spec : { ...spec, direction };
}

/** Rows per page. The pager, the query layer and the offset all read this. */
export const PAGE_SIZE = 50;

export const MAX_PAGE = 1000;

/** Always at least 1: an empty list is page 1 of 1, never page 1 of 0. */
export function pageCount(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampPage(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE);
}

/**
 * Which row actions the studio may take on a ticket, by status.
 *
 * The queue used to be hard-restricted to four statuses, so the action block
 * never had to ask. Driving it from the URL put drafts and signed-off work on
 * the same page — and `/api/admin/tickets/[id]/status` has no transition
 * guard, so "Start" on an approved ticket silently reopens it and emails the
 * client that work they already signed off is now in progress. A draft is the
 * client's own unsubmitted request; the studio has no business touching it at
 * all.
 */
export interface RowActions {
  claim: boolean;
  start: boolean;
  upload: boolean;
  remind: boolean;
  /** Reassignment is still a write to the client's ticket. */
  assign: boolean;
}

/** Work the studio is carrying: not an unsubmitted draft, not signed off. */
const LIVE_STATUSES: readonly TicketStatus[] = [
  "submitted",
  "assigned",
  "in_progress",
  "ready_for_review",
  "revision_requested",
];

export function rowActionsFor(
  status: TicketStatus,
  designerId: string | null,
): RowActions {
  const live = LIVE_STATUSES.includes(status);
  return {
    assign: live,
    claim: live && designerId === null,
    // Already in progress is not a thing to start.
    start: live && status !== "in_progress" && status !== "ready_for_review",
    upload: live,
    /* Only where the designer is actually the blocker. Nobody to reach on an
       unassigned ticket, and work in review is waiting on the CLIENT. */
    remind: live && designerId !== null && status !== "ready_for_review",
  };
}

/**
 * How late a row should say it is, or null for no chip.
 *
 * Through the predicate, not raw arithmetic: a draft past its due date is not
 * overdue — the Overdue card excludes it — and a row wearing the chip anyway
 * reads as a ticket the dashboard forgot to count.
 */
export function lateChipFor(row: ViewableTicket, now: Date): string | null {
  if (!matchesView(row, "overdue", now)) return null;
  const ms = overdueMs(row.dueDate, now);
  return ms === null ? null : formatOverdue(ms);
}

/** What the list is showing, said in the operator's language. */
export const VIEW_LABELS: Record<AdminTicketView, string> = {
  all: "All tickets",
  open: "Open tickets",
  active: "Active work",
  overdue: "Overdue tickets",
  in_progress: "In progress",
  needs_revision: "Needs revision",
  awaiting_review: "Awaiting client review",
  delivered: "Delivered work",
  approved: "Approved work",
};

/**
 * When the studio first handed this ticket over.
 *
 * `deliveredAt` is the column; the fallback covers a row written between the
 * migration's backfill and the deploy that started populating it. Read through
 * one function so the fallback can be deleted in one place once no such row can
 * exist.
 */
export function deliveredDateOf(row: {
  deliveredAt: Date | null;
  firstDeliverableAt?: Date | string | null;
}): Date | null {
  return asDate(row.deliveredAt) ?? asDate(row.firstDeliverableAt);
}

/**
 * Belt and braces on the decoder.
 *
 * `firstDeliverableAt` comes from a raw `sql` fragment, which drizzle decodes
 * with noopDecoder unless `.mapWith` is applied — so a missing `.mapWith`
 * silently yields the wire STRING, and the `sql<Date>` generic does not catch
 * it. The query layer applies `.mapWith`; this makes the failure a blank cell
 * rather than a TypeError that 500s the whole route.
 */
function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
