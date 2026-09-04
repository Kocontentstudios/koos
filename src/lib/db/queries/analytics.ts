import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  type SQL,
  sql,
} from "drizzle-orm";
import type { AnalyticsFilter } from "@/lib/analytics/filter";
import { db } from "@/lib/db/client";
import { brands, designTickets, usageEvents, users } from "@/lib/db/schema";
import { timestampParam } from "@/lib/db/sql/timestamp";

/* Rolling windows are computed in JS (see lib/analytics/rollup.ts) rather than
   with date_trunc, which would force a calendar week-start and a timezone.
   That means fetching timestamps instead of pre-grouped counts, so every raw
   fetch is capped — a dashboard is never worth an unbounded result set. */
const MAX_ROWS = 50_000;

/**
 * The filter, as SQL, for one timestamp column.
 *
 * Every analytics query takes the SAME filter object so a single control can
 * move all of them together. Each query applies the parts that apply to it —
 * a signup has no brand and no ticket status — and says so rather than
 * silently ignoring them.
 */
function windowOf(column: SQL.Aliased | never, filter: AnalyticsFilter): SQL[] {
  const parts: SQL[] = [];
  if (filter.from) parts.push(gte(column, timestampParam(filter.from)));
  // `to` is exclusive by contract — see resolveWindow.
  if (filter.to) parts.push(lt(column, timestampParam(filter.to)));
  return parts;
}

function usageConditions(filter: AnalyticsFilter): SQL[] {
  const parts = windowOf(usageEvents.createdAt as never, filter);
  if (filter.kinds.length)
    parts.push(inArray(usageEvents.kind, [...filter.kinds]));
  if (filter.brandId) parts.push(eq(usageEvents.brandId, filter.brandId));
  return parts;
}

function ticketConditions(filter: AnalyticsFilter): SQL[] {
  const parts = windowOf(designTickets.createdAt as never, filter);
  if (filter.statuses.length)
    parts.push(inArray(designTickets.status, [...filter.statuses]));
  if (filter.brandId) parts.push(eq(designTickets.brandId, filter.brandId));
  return parts;
}

const all = (parts: SQL[]) => (parts.length ? and(...parts) : undefined);

export async function getUsageEvents(filter: AnalyticsFilter) {
  return db
    .select({
      kind: usageEvents.kind,
      brandId: usageEvents.brandId,
      createdAt: usageEvents.createdAt,
    })
    .from(usageEvents)
    .where(all(usageConditions(filter)))
    .limit(MAX_ROWS);
}

/* A signup belongs to no brand and has no ticket status, so those two filters
   cannot narrow it. Applying them would silently zero this card whenever an
   operator filtered by brand — the number would look like an answer. */
export async function getSignups(filter: AnalyticsFilter) {
  return db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(all(windowOf(users.createdAt as never, filter)))
    .limit(MAX_ROWS);
}

export async function getTickets(filter: AnalyticsFilter) {
  return db
    .select({ createdAt: designTickets.createdAt })
    .from(designTickets)
    .where(all(ticketConditions(filter)))
    .limit(MAX_ROWS);
}

/** Brands with at least one generation in the window. */
export async function getActiveBrandCount(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: countDistinct(usageEvents.brandId) })
    .from(usageEvents)
    .where(all([...usageConditions(filter), isNotNull(usageEvents.brandId)]));
  return row?.count ?? 0;
}

export async function getTopBrandsByActivity(
  filter: AnalyticsFilter,
  limit = 8,
) {
  return db
    .select({
      brandId: brands.id,
      name: brands.name,
      count: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .innerJoin(brands, eq(usageEvents.brandId, brands.id))
    .where(all(usageConditions(filter)))
    .groupBy(brands.id, brands.name)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
}

/**
 * Milliseconds from ticket creation to client sign-off.
 *
 * `approved_at` is the completion timestamp; `delivered_at` records the first
 * hand-over, which is a different question. This measures time to APPROVAL and
 * must not be labelled delivery.
 */
export async function getApprovalDurations(filter: AnalyticsFilter) {
  const rows = await db
    .select({
      createdAt: designTickets.createdAt,
      approvedAt: designTickets.approvedAt,
    })
    .from(designTickets)
    .where(
      all([...ticketConditions(filter), isNotNull(designTickets.approvedAt)]),
    )
    .limit(MAX_ROWS);

  return rows
    .filter((r) => r.approvedAt !== null)
    .map((r) => (r.approvedAt as Date).getTime() - r.createdAt.getTime())
    .filter((ms) => ms >= 0);
}

/** Brands an operator can filter by, newest first. */
export async function getBrandFilterOptions(limit = 200) {
  return db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .orderBy(brands.name)
    .limit(limit);
}

/* ── Records behind a metric (ADMIN-FEAT-003 / 007) ────────────────────── */

/** Generations, with the brand and person behind each one. */
export async function listGenerationRecords(
  filter: AnalyticsFilter,
  limit = 50,
  offset = 0,
) {
  return db
    .select({
      id: usageEvents.id,
      kind: usageEvents.kind,
      createdAt: usageEvents.createdAt,
      brandId: usageEvents.brandId,
      brandName: brands.name,
      userEmail: users.email,
      userFirstName: users.firstName,
      userLastName: users.lastName,
    })
    .from(usageEvents)
    .leftJoin(brands, eq(usageEvents.brandId, brands.id))
    .leftJoin(users, eq(usageEvents.userId, users.id))
    .where(all(usageConditions(filter)))
    .orderBy(desc(usageEvents.createdAt), asc(usageEvents.id))
    .limit(limit)
    .offset(offset);
}

export async function countGenerationRecords(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(all(usageConditions(filter)));
  return row?.count ?? 0;
}

/** Accounts created in the window. */
export async function listUserRecords(
  filter: AnalyticsFilter,
  limit = 50,
  offset = 0,
) {
  return db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(all(windowOf(users.createdAt as never, filter)))
    .orderBy(desc(users.createdAt), asc(users.id))
    .limit(limit)
    .offset(offset);
}

export async function countUserRecords(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(users)
    .where(all(windowOf(users.createdAt as never, filter)));
  return row?.count ?? 0;
}

/**
 * The approved tickets behind the median.
 *
 * Returns the dates the metric is computed from, so an operator can check the
 * number rather than take it on faith — which is what FEAT-003 asks for by
 * naming "the tickets used to calculate the metric".
 */
export async function listApprovalRecords(
  filter: AnalyticsFilter,
  limit = 50,
  offset = 0,
) {
  return db
    .select({
      id: designTickets.id,
      ticketNumber: designTickets.ticketNumber,
      title: designTickets.title,
      designType: designTickets.designType,
      createdAt: designTickets.createdAt,
      deliveredAt: designTickets.deliveredAt,
      approvedAt: designTickets.approvedAt,
      brandName: brands.name,
      designerFirstName: users.firstName,
      designerLastName: users.lastName,
      designerEmail: users.email,
    })
    .from(designTickets)
    .leftJoin(brands, eq(designTickets.brandId, brands.id))
    .leftJoin(users, eq(designTickets.assignedDesignerId, users.id))
    .where(
      all([...ticketConditions(filter), isNotNull(designTickets.approvedAt)]),
    )
    .orderBy(desc(designTickets.approvedAt), asc(designTickets.id))
    .limit(limit)
    .offset(offset);
}

export async function countApprovalRecords(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(designTickets)
    .where(
      all([...ticketConditions(filter), isNotNull(designTickets.approvedAt)]),
    );
  return row?.count ?? 0;
}

/** Brands with activity in the window, with their owner and last activity. */
export async function listBrandRecords(
  filter: AnalyticsFilter,
  limit = 50,
  offset = 0,
) {
  return db
    .select({
      brandId: brands.id,
      name: brands.name,
      ownerEmail: users.email,
      ownerFirstName: users.firstName,
      ownerLastName: users.lastName,
      lastActiveAt: sql<Date>`max(${usageEvents.createdAt})`.mapWith(
        usageEvents.createdAt,
      ),
      count: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .innerJoin(brands, eq(usageEvents.brandId, brands.id))
    .leftJoin(users, eq(brands.userId, users.id))
    .where(all(usageConditions(filter)))
    .groupBy(
      brands.id,
      brands.name,
      users.email,
      users.firstName,
      users.lastName,
    )
    .orderBy(desc(sql`count(*)`), asc(brands.id))
    .limit(limit)
    .offset(offset);
}

export async function countBrandRecords(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: countDistinct(usageEvents.brandId) })
    .from(usageEvents)
    .innerJoin(brands, eq(usageEvents.brandId, brands.id))
    .where(all(usageConditions(filter)));
  return row?.count ?? 0;
}

/** The design tickets behind the Tickets card. */
export async function listTicketRecords(
  filter: AnalyticsFilter,
  limit = 50,
  offset = 0,
) {
  return db
    .select({
      id: designTickets.id,
      ticketNumber: designTickets.ticketNumber,
      title: designTickets.title,
      designType: designTickets.designType,
      status: designTickets.status,
      createdAt: designTickets.createdAt,
      brandName: brands.name,
    })
    .from(designTickets)
    .leftJoin(brands, eq(designTickets.brandId, brands.id))
    .where(all(ticketConditions(filter)))
    .orderBy(desc(designTickets.createdAt), asc(designTickets.id))
    .limit(limit)
    .offset(offset);
}

export async function countTicketRecords(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(designTickets)
    .where(all(ticketConditions(filter)));
  return row?.count ?? 0;
}
