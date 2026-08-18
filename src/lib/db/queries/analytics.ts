import { and, countDistinct, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { brands, designTickets, usageEvents, users } from "@/lib/db/schema";

/* Rolling windows are computed in JS (see lib/analytics/rollup.ts) rather than
   with date_trunc, which would force a calendar week-start and a timezone.
   That means fetching timestamps instead of pre-grouped counts, so every raw
   fetch is capped — a dashboard is never worth an unbounded result set. */
const MAX_ROWS = 50_000;

export async function getUsageEventsSince(since: Date) {
  return db
    .select({ kind: usageEvents.kind, createdAt: usageEvents.createdAt })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, since))
    .limit(MAX_ROWS);
}

export async function getSignupsSince(since: Date) {
  return db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(gte(users.createdAt, since))
    .limit(MAX_ROWS);
}

export async function getTicketsSince(since: Date) {
  return db
    .select({ createdAt: designTickets.createdAt })
    .from(designTickets)
    .where(gte(designTickets.createdAt, since))
    .limit(MAX_ROWS);
}

/** Brands with at least one generation in the window. */
export async function getActiveBrandCount(since: Date) {
  const [row] = await db
    .select({ count: countDistinct(usageEvents.brandId) })
    .from(usageEvents)
    .where(
      and(gte(usageEvents.createdAt, since), isNotNull(usageEvents.brandId)),
    );
  return row?.count ?? 0;
}

export async function getTopBrandsByActivity(since: Date, limit = 8) {
  return db
    .select({
      brandId: brands.id,
      name: brands.name,
      count: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .innerJoin(brands, eq(usageEvents.brandId, brands.id))
    .where(gte(usageEvents.createdAt, since))
    .groupBy(brands.id, brands.name)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
}

/**
 * Milliseconds from ticket creation to client sign-off. There is no
 * delivered_at column, so approved_at is the only real completion timestamp —
 * this measures time to approval, and must not be labelled delivery.
 */
export async function getApprovalDurationsSince(since: Date) {
  const rows = await db
    .select({
      createdAt: designTickets.createdAt,
      approvedAt: designTickets.approvedAt,
    })
    .from(designTickets)
    .where(
      and(
        gte(designTickets.createdAt, since),
        isNotNull(designTickets.approvedAt),
      ),
    )
    .limit(MAX_ROWS);

  return rows
    .filter((r) => r.approvedAt !== null)
    .map((r) => (r.approvedAt as Date).getTime() - r.createdAt.getTime())
    .filter((ms) => ms >= 0);
}
