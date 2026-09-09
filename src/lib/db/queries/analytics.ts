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
import {
  brands,
  calendarItems,
  calendars,
  designTickets,
  strategies,
  ticketUpdates,
  usageEvents,
  users,
  workspaces,
} from "@/lib/db/schema";
import { timestampParam } from "@/lib/db/sql/timestamp";

/* Rolling windows are computed in JS (see lib/analytics/rollup.ts) rather than
   with date_trunc, which would force a calendar week-start and a timezone.
   That means fetching timestamps instead of pre-grouped counts, so every raw
   fetch is capped — a dashboard is never worth an unbounded result set.

   The cap is a truncation, not a filter, so every capped fetch is ORDERED:
   without it the rows kept are whatever the plan produced, and the trend chart,
   the breakdowns and the time-to-approval MEDIAN would be computed from an
   arbitrary sample rather than from the newest data. Callers that show a count
   beside capped rows must use the matching count* query, which is not capped —
   see hitCap. */
export const MAX_ROWS = 50_000;

/**
 * The filter, as SQL, for one timestamp column.
 *
 * Every analytics query takes the SAME filter object so a single control can
 * move all of them together. Each query applies the parts that apply to it —
 * a signup has no brand and no ticket status — and says so rather than
 * silently ignoring them.
 */
/* The columns a window may be applied to, named explicitly. The previous
   signature was `SQL.Aliased | never`, which collapses to SQL.Aliased and made
   every call site launder a PgColumn through `as never` — so
   `windowOf(users.email, ...)` compiled clean and would have shipped
   `"users"."email" >= $1::timestamp`, a Postgres operator-does-not-exist 500. */
type TimestampColumn =
  | typeof usageEvents.createdAt
  | typeof users.createdAt
  | typeof designTickets.createdAt
  | typeof designTickets.approvedAt
  | typeof designTickets.deliveredAt
  | typeof strategies.createdAt
  | typeof calendarItems.createdAt
  | typeof ticketUpdates.createdAt
  | typeof brands.createdAt;

function windowOf(column: TimestampColumn, filter: AnalyticsFilter): SQL[] {
  const parts: SQL[] = [];
  if (filter.from) parts.push(gte(column, timestampParam(filter.from)));
  // `to` is exclusive by contract — see resolveWindow.
  if (filter.to) parts.push(lt(column, timestampParam(filter.to)));
  return parts;
}

function usageConditions(filter: AnalyticsFilter): SQL[] {
  const parts = windowOf(usageEvents.createdAt, filter);
  if (filter.kinds.length)
    parts.push(inArray(usageEvents.kind, [...filter.kinds]));
  if (filter.brandId) parts.push(eq(usageEvents.brandId, filter.brandId));
  return parts;
}

/**
 * Approvals are windowed on when they were APPROVED, not created.
 *
 * Every string around this metric says "approved" — the card, the record
 * description, the empty state — and windowing on created_at contradicts all
 * of them: a ticket created Aug 1 and signed off Sep 4 vanishes from "last 7
 * days", so the card reads "median of 0 approved" while one was. It also
 * biases the metric, because a 7-day window on created_at can only contain
 * approvals that took under 7 days.
 */
function approvalConditions(filter: AnalyticsFilter): SQL[] {
  const parts = windowOf(designTickets.approvedAt, filter);
  parts.push(isNotNull(designTickets.approvedAt));
  if (filter.statuses.length)
    parts.push(inArray(designTickets.status, [...filter.statuses]));
  if (filter.brandId) parts.push(eq(designTickets.brandId, filter.brandId));
  return parts;
}

function ticketConditions(filter: AnalyticsFilter): SQL[] {
  const parts = windowOf(designTickets.createdAt, filter);
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
    .orderBy(desc(usageEvents.createdAt), asc(usageEvents.id))
    .limit(MAX_ROWS);
}

/* A signup belongs to no brand and has no ticket status, so those two filters
   cannot narrow it. Applying them would silently zero this card whenever an
   operator filtered by brand — the number would look like an answer. */
export async function getSignups(filter: AnalyticsFilter) {
  return db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(all(windowOf(users.createdAt, filter)))
    .orderBy(desc(users.createdAt), asc(users.id))
    .limit(MAX_ROWS);
}

export async function getTickets(filter: AnalyticsFilter) {
  return db
    .select({ createdAt: designTickets.createdAt })
    .from(designTickets)
    .where(all(ticketConditions(filter)))
    .orderBy(desc(designTickets.createdAt), asc(designTickets.id))
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
  return (
    db
      .select({
        brandId: brands.id,
        name: brands.name,
        count: sql<number>`count(*)::int`,
      })
      .from(usageEvents)
      .innerJoin(brands, eq(usageEvents.brandId, brands.id))
      .where(all(usageConditions(filter)))
      .groupBy(brands.id, brands.name)
      /* asc(id) so brands tied on activity do not reshuffle between renders and
       silently change which ones make the top slice. */
      .orderBy(desc(sql`count(*)`), asc(brands.id))
      .limit(limit)
  );
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
    .where(all(approvalConditions(filter)))
    .orderBy(desc(designTickets.approvedAt), asc(designTickets.id))
    .limit(MAX_ROWS);

  return rows
    .filter((r) => r.approvedAt !== null)
    .map((r) => (r.approvedAt as Date).getTime() - r.createdAt.getTime())
    .filter((ms) => ms >= 0);
}

/**
 * Brands an operator can filter by, MOST ACTIVE first.
 *
 * FEAT-005 asks to filter by "most active brand". Ordering by name and taking
 * the first twelve makes the busiest brand unselectable whenever its name sorts
 * late — with forty brands, "Zenith" could not be reached from the UI at all.
 * Ordered by activity within the current window, so the options track what the
 * operator is actually looking at.
 */
export async function getBrandFilterOptions(
  filter: AnalyticsFilter,
  limit = 12,
) {
  return (
    db
      .select({
        id: brands.id,
        name: brands.name,
        count: sql<number>`count(*)::int`,
      })
      .from(usageEvents)
      .innerJoin(brands, eq(usageEvents.brandId, brands.id))
      .where(all(usageConditions({ ...filter, brandId: null })))
      .groupBy(brands.id, brands.name)
      /* asc(id) so ties do not flap between renders and silently change which
       brands are offered. */
      .orderBy(desc(sql`count(*)`), asc(brands.id))
      .limit(limit)
  );
}

/** How many brands had activity, so the UI can say the list is a top slice. */
export async function countActiveBrandOptions(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: countDistinct(usageEvents.brandId) })
    .from(usageEvents)
    .innerJoin(brands, eq(usageEvents.brandId, brands.id))
    .where(all(usageConditions({ ...filter, brandId: null })));
  return row?.count ?? 0;
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
      /* FEAT-003 asks for the signup's brand. A user may own several; the
         first one they created is the one that identifies them. */
      brandName: sql<string | null>`(
        select ${brands.name} from ${brands}
        where ${brands.userId} = ${users.id}
        order by ${brands.createdAt} asc
        limit 1
      )`,
    })
    .from(users)
    .where(all(windowOf(users.createdAt, filter)))
    .orderBy(desc(users.createdAt), asc(users.id))
    .limit(limit)
    .offset(offset);
}

export async function countUserRecords(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(users)
    .where(all(windowOf(users.createdAt, filter)));
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
    .where(all(approvalConditions(filter)))
    .orderBy(desc(designTickets.approvedAt), asc(designTickets.id))
    .limit(limit)
    .offset(offset);
}

export async function countApprovalRecords(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(designTickets)
    .where(all(approvalConditions(filter)));
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
      workspaceName: workspaces.name,
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

/* ── The eight metrics (ADMIN-FEAT-004) ────────────────────────────────────

   Two of the eight are NOT here: Overdue tickets and Delivered projects call
   countAdminTickets with a patched scope, the same function the pages they
   link to run. A second definition of "overdue" is how a card and its list
   drift apart, and this codebase has already had that bug twice. */

/* A campaign IS a strategy row — the product has no separate campaign entity,
   and usage_kind has no "campaign" value. Windowed on when the strategy was
   created; the ticket status filter cannot narrow a strategy. */
function strategyConditions(filter: AnalyticsFilter): SQL[] {
  const parts = windowOf(strategies.createdAt, filter);
  if (filter.brandId) parts.push(eq(strategies.brandId, filter.brandId));
  return parts;
}

/* calendar_items carries no brand of its own; it reaches one through its
   calendar, so the brand filter needs that join and callers must include it. */
function calendarConditions(filter: AnalyticsFilter): SQL[] {
  const parts = windowOf(calendarItems.createdAt, filter);
  if (filter.brandId) parts.push(eq(calendars.brandId, filter.brandId));
  return parts;
}

/* Revisions are counted as EVENTS, not tickets. A ticket sent back three times
   is three revision requests; counting tickets would report it once and then
   lose it entirely the moment its status moved on. */
function revisionConditions(filter: AnalyticsFilter): SQL[] {
  const parts = windowOf(ticketUpdates.createdAt, filter);
  parts.push(eq(ticketUpdates.newStatus, "revision_requested"));
  if (filter.brandId) parts.push(eq(designTickets.brandId, filter.brandId));
  return parts;
}

/* Windowed on delivery, not creation: "of the work handed over in this window,
   how much came back approved". Windowing on created_at would put a ticket's
   delivery in the window that produced the REQUEST, which is a different
   question and biases the rate toward fast jobs. */
function deliveryConditions(filter: AnalyticsFilter): SQL[] {
  const parts = windowOf(designTickets.deliveredAt, filter);
  parts.push(isNotNull(designTickets.deliveredAt));
  if (filter.brandId) parts.push(eq(designTickets.brandId, filter.brandId));
  return parts;
}

export async function getCampaignCount(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(strategies)
    .where(all(strategyConditions(filter)));
  return row?.count ?? 0;
}

export async function getCalendarActivityCount(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(calendarItems)
    .innerJoin(calendars, eq(calendarItems.calendarId, calendars.id))
    .where(all(calendarConditions(filter)));
  return row?.count ?? 0;
}

export async function getRevisionRequestCount(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(ticketUpdates)
    .innerJoin(designTickets, eq(ticketUpdates.ticketId, designTickets.id))
    .where(all(revisionConditions(filter)));
  return row?.count ?? 0;
}

/**
 * Share of delivered work the client signed off.
 *
 * `rate` is null — never 0, never NaN — when nothing was delivered in the
 * window. Zero would claim every delivery was rejected; NaN renders as "NaN%".
 * The caller shows an em dash and the denominator either way, so the number is
 * never read without the population it came from.
 */
export async function getApprovalRate(filter: AnalyticsFilter) {
  const [row] = await db
    .select({
      delivered: count(),
      approved: sql<number>`count(*) filter (where ${designTickets.status} = 'delivered')::int`,
    })
    .from(designTickets)
    .where(all(deliveryConditions(filter)));

  const delivered = row?.delivered ?? 0;
  const approved = row?.approved ?? 0;
  return {
    delivered,
    approved,
    rate: delivered === 0 ? null : (approved / delivered) * 100,
  };
}

/**
 * How complete the brands created in this window are.
 *
 * Computed with brandProfileCompletion by the caller, NOT read from
 * brands.completion_percentage: the stored column and the computed function
 * disagree, and every other surface in the product (the admin brands table,
 * the brand page) uses the computed one. Reconciling the column is its own
 * ticket; this must not be the place the two versions of the truth meet.
 */
/* METRIC_FILTERS says the brand filter narrows this metric, so it has to be
   applied here — the header would otherwise claim a narrowing the query never
   performed. */
function brandSetupConditions(filter: AnalyticsFilter): SQL[] {
  const parts = windowOf(brands.createdAt, filter);
  if (filter.brandId) parts.push(eq(brands.id, filter.brandId));
  return parts;
}

export async function getBrandSetupRows(filter: AnalyticsFilter) {
  return db
    .select()
    .from(brands)
    .where(all(brandSetupConditions(filter)))
    .orderBy(desc(brands.createdAt), asc(brands.id))
    .limit(MAX_ROWS);
}

/* ── Records behind the new metrics ────────────────────────────────────── */

export async function listCampaignRecords(
  filter: AnalyticsFilter,
  limit = 50,
  offset = 0,
) {
  return db
    .select({
      id: strategies.id,
      name: strategies.name,
      status: strategies.status,
      createdAt: strategies.createdAt,
      brandId: strategies.brandId,
      brandName: brands.name,
    })
    .from(strategies)
    .leftJoin(brands, eq(strategies.brandId, brands.id))
    .where(all(strategyConditions(filter)))
    .orderBy(desc(strategies.createdAt), asc(strategies.id))
    .limit(limit)
    .offset(offset);
}

export async function countCampaignRecords(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(strategies)
    .where(all(strategyConditions(filter)));
  return row?.count ?? 0;
}

export async function listCalendarRecords(
  filter: AnalyticsFilter,
  limit = 50,
  offset = 0,
) {
  return db
    .select({
      id: calendarItems.id,
      title: calendarItems.title,
      platform: calendarItems.platform,
      status: calendarItems.status,
      /* ai | manual. The ticket asks for calendar activity split by how it was
         authored, and this column is the only place that is recorded. */
      source: calendarItems.source,
      date: calendarItems.date,
      createdAt: calendarItems.createdAt,
      brandName: brands.name,
    })
    .from(calendarItems)
    .innerJoin(calendars, eq(calendarItems.calendarId, calendars.id))
    .leftJoin(brands, eq(calendars.brandId, brands.id))
    .where(all(calendarConditions(filter)))
    .orderBy(desc(calendarItems.createdAt), asc(calendarItems.id))
    .limit(limit)
    .offset(offset);
}

export async function countCalendarRecords(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(calendarItems)
    .innerJoin(calendars, eq(calendarItems.calendarId, calendars.id))
    .where(all(calendarConditions(filter)));
  return row?.count ?? 0;
}

/** The population behind the approval rate: everything handed over, and how it
 *  ended. */
export async function listDeliveryRecords(
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
      deliveredAt: designTickets.deliveredAt,
      approvedAt: designTickets.approvedAt,
      brandName: brands.name,
    })
    .from(designTickets)
    .leftJoin(brands, eq(designTickets.brandId, brands.id))
    .where(all(deliveryConditions(filter)))
    .orderBy(desc(designTickets.deliveredAt), asc(designTickets.id))
    .limit(limit)
    .offset(offset);
}

export async function countDeliveryRecords(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(designTickets)
    .where(all(deliveryConditions(filter)));
  return row?.count ?? 0;
}

export async function listRevisionRecords(
  filter: AnalyticsFilter,
  limit = 50,
  offset = 0,
) {
  return db
    .select({
      id: ticketUpdates.id,
      ticketId: designTickets.id,
      ticketNumber: designTickets.ticketNumber,
      title: designTickets.title,
      designType: designTickets.designType,
      message: ticketUpdates.message,
      createdAt: ticketUpdates.createdAt,
      brandName: brands.name,
    })
    .from(ticketUpdates)
    .innerJoin(designTickets, eq(ticketUpdates.ticketId, designTickets.id))
    .leftJoin(brands, eq(designTickets.brandId, brands.id))
    .where(all(revisionConditions(filter)))
    .orderBy(desc(ticketUpdates.createdAt), asc(ticketUpdates.id))
    .limit(limit)
    .offset(offset);
}

export async function countRevisionRecords(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(ticketUpdates)
    .innerJoin(designTickets, eq(ticketUpdates.ticketId, designTickets.id))
    .where(all(revisionConditions(filter)));
  return row?.count ?? 0;
}

export async function listBrandSetupRecords(
  filter: AnalyticsFilter,
  limit = 50,
  offset = 0,
) {
  return db
    .select()
    .from(brands)
    .where(all(brandSetupConditions(filter)))
    .orderBy(desc(brands.createdAt), asc(brands.id))
    .limit(limit)
    .offset(offset);
}

export async function countBrandSetupRecords(filter: AnalyticsFilter) {
  const [row] = await db
    .select({ count: count() })
    .from(brands)
    .where(all(brandSetupConditions(filter)));
  return row?.count ?? 0;
}
