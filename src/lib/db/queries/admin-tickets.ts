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
  lte,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  resolveWindow,
  sortToColumn,
  VIEW_PREDICATES,
} from "@/lib/admin/scope";
import type { AdminScope } from "@/lib/admin/scope-params";
import { db } from "@/lib/db/client";
import { brands, designTickets, users } from "@/lib/db/schema";
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
 *  by nature and the page it feeds shows fifty rows. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

/* Two aliases of `users` in one query: the person who asked for the design and
   the designer carrying it. */
const requester = alias(users, "requester");
const designer = alias(users, "designer");

function viewConditions(scope: AdminScope, now: Date): SQL[] {
  const p = VIEW_PREDICATES[scope.view];
  const parts: SQL[] = [];
  if (p.statusIn) parts.push(inArray(designTickets.status, [...p.statusIn]));
  if (p.statusNotIn)
    parts.push(notInArray(designTickets.status, [...p.statusNotIn]));
  if (p.approved === "only") parts.push(isNotNull(designTickets.approvedAt));
  if (p.approved === "none") parts.push(isNull(designTickets.approvedAt));
  if (p.overdue) parts.push(lt(designTickets.dueDate, now));
  return parts;
}

function scopeConditions(scope: AdminScope, now: Date): SQL[] {
  const parts = viewConditions(scope, now);

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
    delivered: designTickets.createdAt,
    approved: designTickets.approvedAt,
  }[scope.on];
  const window = resolveWindow({
    range: scope.range,
    from: scope.from,
    to: scope.to,
    now,
  });
  if (window.from) {
    parts.push(gte(anchor, window.from));
    parts.push(lte(anchor, window.to));
  }

  /* Server-side on purpose: filtering a paginated list in the browser searches
     only the rows already on screen, which looks like a working feature and is
     a correctness bug. */
  if (scope.q.trim()) {
    const term = `%${scope.q.trim()}%`;
    const digits = scope.q.replace(/\D/g, "");
    const clauses = [
      ilike(designTickets.title, term),
      ilike(designTickets.brief, term),
      ilike(brands.name, term),
      ilike(requester.email, term),
    ];
    if (digits)
      clauses.push(eq(designTickets.ticketNumber, Number.parseInt(digits, 10)));
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

function orderFor(scope: AdminScope) {
  const spec = sortToColumn(scope.sort);
  const column = SORT_COLUMNS[spec.field];
  const direction = spec.direction === "asc" ? asc : desc;
  // Nulls last so a ticket with no due date never outranks a genuinely late one.
  return spec.nulls === "last"
    ? sql`${column} ${sql.raw(spec.direction)} NULLS LAST`
    : direction(column);
}

const rowShape = {
  id: designTickets.id,
  ticketNumber: designTickets.ticketNumber,
  title: designTickets.title,
  designType: designTickets.designType,
  status: designTickets.status,
  priority: designTickets.priority,
  dueDate: designTickets.dueDate,
  createdAt: designTickets.createdAt,
  updatedAt: designTickets.updatedAt,
  approvedAt: designTickets.approvedAt,
  brandId: designTickets.brandId,
  brandName: brands.name,
  requesterId: designTickets.userId,
  requesterEmail: requester.email,
  designerId: designTickets.assignedDesignerId,
  designerFirstName: designer.firstName,
  designerLastName: designer.lastName,
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
    .leftJoin(requester, eq(designTickets.userId, requester.id))
    .leftJoin(designer, eq(designTickets.assignedDesignerId, designer.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(orderFor(scope))
    .limit(limit)
    .offset((scope.page - 1) * limit);
}

export async function countAdminTickets(
  scope: AdminScope,
  opts: { now?: Date } = {},
) {
  const now = opts.now ?? new Date();
  const conditions = scopeConditions(scope, now);
  const [row] = await db
    .select({ count: count() })
    .from(designTickets)
    .leftJoin(brands, eq(designTickets.brandId, brands.id))
    .leftJoin(requester, eq(designTickets.userId, requester.id))
    .where(conditions.length ? and(...conditions) : undefined);
  return row?.count ?? 0;
}

/** What a designer is carrying right now, for the workload drill-down. */
export async function getWorkloadForDesigner(
  designerId: string,
  now = new Date(),
) {
  const [row] = await db
    .select({
      active: count(),
      overdue: sql<number>`count(*) filter (where ${designTickets.dueDate} < ${timestampParam(now)} and ${designTickets.approvedAt} is null)`,
    })
    .from(designTickets)
    .where(
      and(
        eq(designTickets.assignedDesignerId, designerId),
        inArray(designTickets.status, [
          "assigned",
          "in_progress",
          "ready_for_review",
        ]),
      ),
    );
  return { active: row?.active ?? 0, overdue: Number(row?.overdue ?? 0) };
}
