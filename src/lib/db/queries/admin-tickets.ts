import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  type AdminTicketView,
  defaultSortKeyFor,
  PAGE_SIZE,
  resolveWindow,
  sortToColumn,
  VIEW_PREDICATES,
} from "@/lib/admin/scope";
import type { AdminScope } from "@/lib/admin/scope-params";
import { db } from "@/lib/db/client";
import {
  brands,
  calendarItems,
  calendars,
  designTickets,
  strategies,
  users,
} from "@/lib/db/schema";
import { timestampParam } from "@/lib/db/sql/timestamp";

/**
 * The only place an admin scope becomes SQL.
 *
 * Conditions are derived from `VIEW_PREDICATES` rather than a parallel switch,
 * so this cannot disagree with `matchesView` about which statuses a view
 * covers — that map is the single definition and it is tested without a
 * database.
 */

/** Hard ceiling regardless of what a caller asks for: this list is unbounded
 *  by nature and the page it feeds shows one PAGE_SIZE at a time. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = PAGE_SIZE;

const MAX_INT4 = 2_147_483_647;

/**
 * The ticket number a free-text query is asking for, or null.
 *
 * `ticket_number` is a Postgres `integer`. A search like "+2348012345678"
 * yields a digit run that overflows it, and comparing an out-of-range literal
 * is a query ERROR rather than a miss — so without this guard the search box
 * returns a 500 on any phone number.
 *
 * Exported so the guard is tested directly instead of restated in a test.
 */
export function ticketNumberFor(query: string): number | null {
  const digits = query.replace(/\D/g, "");
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_INT4) return null;
  return parsed;
}

/* Two aliases of `users` in one query: the person who asked for the design and
   the designer carrying it. */
const requester = alias(users, "requester");
const designer = alias(users, "designer");

export function viewConditions(view: AdminTicketView, now: Date): SQL[] {
  const p = VIEW_PREDICATES[view];
  const parts: SQL[] = [];
  if (p.statusIn) parts.push(inArray(designTickets.status, [...p.statusIn]));
  if (p.statusNotIn)
    parts.push(notInArray(designTickets.status, [...p.statusNotIn]));
  if (p.approved === "only") parts.push(isNotNull(designTickets.approvedAt));
  if (p.approved === "none") parts.push(isNull(designTickets.approvedAt));
  if (p.overdue) parts.push(lt(designTickets.dueDate, timestampParam(now)));
  return parts;
}

/** `%` and `_` are ilike wildcards, so a search for "50%" matched every row. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Whether the scope's text search needs the joined brand/requester columns. */
function needsSearchJoins(scope: AdminScope): boolean {
  return scope.q.trim().length > 0;
}

export function scopeConditions(scope: AdminScope, now: Date): SQL[] {
  const parts = viewConditions(scope.view, now);

  // Narrows WITHIN the view rather than replacing it, so a status row's link
  // and a view can be combined without either winning.
  if (scope.status.length)
    parts.push(inArray(designTickets.status, [...scope.status]));

  if (scope.assignee === "unassigned")
    parts.push(isNull(designTickets.assignedDesignerId));
  else if (scope.assignee)
    parts.push(eq(designTickets.assignedDesignerId, scope.assignee));

  if (scope.brand) parts.push(eq(designTickets.brandId, scope.brand));
  if (scope.requester) parts.push(eq(designTickets.userId, scope.requester));

  const anchor = {
    created: designTickets.createdAt,
    due: designTickets.dueDate,
    approved: designTickets.approvedAt,
  }[scope.on];
  const window = resolveWindow({
    range: scope.range,
    from: scope.from,
    to: scope.to,
    now,
  });
  if (window.from) parts.push(gte(anchor, timestampParam(window.from)));
  // Independently: an end-only custom range has no lower bound, and guarding
  // this on `window.from` dropped its upper bound with it. `to` is exclusive
  // by contract — see resolveWindow.
  if (window.to) parts.push(lt(anchor, timestampParam(window.to)));

  /* Server-side on purpose: filtering a paginated list in the browser searches
     only the rows already on screen, which looks like a working feature and is
     a correctness bug. */
  const term = scope.q.trim();
  if (term) {
    const like = `%${escapeLike(term)}%`;
    const clauses = [
      ilike(designTickets.title, like),
      ilike(designTickets.brief, like),
      ilike(brands.name, like),
      ilike(requester.email, like),
    ];
    const ticketNumber = ticketNumberFor(term);
    if (ticketNumber !== null)
      clauses.push(eq(designTickets.ticketNumber, ticketNumber));
    const matched = or(...clauses);
    if (matched) parts.push(matched);
  }

  return parts;
}

const SORT_COLUMNS = {
  createdAt: designTickets.createdAt,
  updatedAt: designTickets.updatedAt,
  dueDate: designTickets.dueDate,
  ticketNumber: designTickets.ticketNumber,
  priority: designTickets.priority,
} as const;

/**
 * Ordering, always fully determined.
 *
 * The trailing `id` is not decoration: without a total order, rows that tie on
 * the sort column come back in whatever order the plan produced, so paging can
 * show the same ticket twice and never show another.
 */
function orderFor(scope: AdminScope): SQL[] {
  const spec = sortToColumn(scope.sort || defaultSortKeyFor(scope.view));
  const column = SORT_COLUMNS[spec.field];
  const direction = spec.direction === "asc" ? asc : desc;
  const clauses: SQL[] = [direction(column)];
  if (spec.field !== "createdAt") clauses.push(desc(designTickets.createdAt));
  clauses.push(asc(designTickets.id));
  return clauses;
}

const rowShape = {
  id: designTickets.id,
  ticketNumber: designTickets.ticketNumber,
  title: designTickets.title,
  designType: designTickets.designType,
  dimensions: designTickets.dimensions,
  slides: designTickets.slides,
  brief: designTickets.brief,
  status: designTickets.status,
  priority: designTickets.priority,
  dueDate: designTickets.dueDate,
  createdAt: designTickets.createdAt,
  updatedAt: designTickets.updatedAt,
  approvedAt: designTickets.approvedAt,
  brandId: designTickets.brandId,
  brandName: brands.name,
  campaignName: strategies.name,
  itemTitle: calendarItems.title,
  requesterId: designTickets.userId,
  requesterEmail: requester.email,
  designerId: designTickets.assignedDesignerId,
  designerFirstName: designer.firstName,
  designerLastName: designer.lastName,
  designerEmail: designer.email,
};

export type AdminTicketRow = Awaited<
  ReturnType<typeof listAdminTickets>
>[number];

export async function listAdminTickets(
  scope: AdminScope,
  opts: { now?: Date; limit?: number } = {},
) {
  const now = opts.now ?? new Date();
  const limit = Math.min(opts.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const conditions = scopeConditions(scope, now);

  return db
    .select(rowShape)
    .from(designTickets)
    .leftJoin(brands, eq(designTickets.brandId, brands.id))
    .leftJoin(calendarItems, eq(designTickets.calendarItemId, calendarItems.id))
    .leftJoin(calendars, eq(calendarItems.calendarId, calendars.id))
    .leftJoin(strategies, eq(calendars.strategyId, strategies.id))
    .leftJoin(requester, eq(designTickets.userId, requester.id))
    .leftJoin(designer, eq(designTickets.assignedDesignerId, designer.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderFor(scope))
    .limit(limit)
    .offset((scope.page - 1) * limit);
}

export async function countAdminTickets(
  scope: AdminScope,
  opts: { now?: Date } = {},
) {
  const now = opts.now ?? new Date();
  const conditions = scopeConditions(scope, now);
  /* The joins exist only to widen the text search. Every other drill-down —
     including the dashboard's Overdue card, which runs on every render — has no
     business paying for two of them. */
  const base = db.select({ count: count() }).from(designTickets);
  const query = needsSearchJoins(scope)
    ? base
        .leftJoin(brands, eq(designTickets.brandId, brands.id))
        .leftJoin(requester, eq(designTickets.userId, requester.id))
    : base;
  const [row] = await query.where(
    conditions.length ? and(...conditions) : undefined,
  );
  return row?.count ?? 0;
}

/**
 * What a designer is carrying right now, for the workload drill-down.
 *
 * Both halves come from `VIEW_PREDICATES` rather than restating the status list
 * here, so the header can never claim a different "active" than the list it
 * sits above.
 */
/** The two aggregates, separated from the query so both are testable. */
export function workloadCounts(now: Date) {
  return {
    active: sql<number>`count(*) filter (where ${and(...viewConditions("active", now))})`,
    overdue: sql<number>`count(*) filter (where ${and(...viewConditions("overdue", now))})`,
  };
}

export async function getWorkloadForDesigner(
  designerId: string,
  now = new Date(),
) {
  /* Both counts are filters over the SAME designer-scoped rows, not one nested
     inside the other. Computing overdue within the `active` narrowing made the
     header report 0 while the Overdue tab directly beneath it listed the
     ticket — `overdue` also covers submitted and revision_requested work,
     which `active` does not. */
  const counts = workloadCounts(now);
  const [row] = await db
    .select(counts)
    .from(designTickets)
    .where(eq(designTickets.assignedDesignerId, designerId));
  return {
    active: Number(row?.active ?? 0),
    overdue: Number(row?.overdue ?? 0),
  };
}
