import { type SQL, sql } from "drizzle-orm";
import { calendars } from "@/lib/db/schema";
import { timestampParam } from "./timestamp";

/*
 * The widen fragments live here, apart from the query that runs them, so a
 * test can assert the SQL that actually ships. Building a lookalike fragment
 * in the test instead would let the real query regress silently.
 */

/** Monotonic bounds: a stale concurrent widen can never shrink the window. */
export function widenWindowSet(date: Date) {
  return {
    startDate: sql`least(${calendars.startDate}, ${timestampParam(date)})`,
    endDate: sql`greatest(${calendars.endDate}, ${timestampParam(date)})`,
  };
}

/** Makes an in-range date a no-op rather than a pointless UPDATE. */
export function widenWindowGuard(date: Date): SQL {
  return sql`(${timestampParam(date)} < ${calendars.startDate} OR ${timestampParam(date)} > ${calendars.endDate})`;
}
