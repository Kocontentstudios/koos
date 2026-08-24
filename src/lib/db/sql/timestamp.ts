import { type SQL, sql } from "drizzle-orm";

/**
 * A Date bound for use inside a raw `sql` fragment.
 *
 * Interpolating a Date directly (`sql`least(col, ${date})`) bypasses drizzle's
 * column type mapping, so the value reaches the driver untyped. Observed
 * failure, against Postgres, from the calendar widen query:
 *
 *   TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of type
 *   string or an instance of Buffer or ArrayBuffer. Received an instance of Date
 *
 * Only raw fragments hit this; ordinary `.set({ col: date })` bindings are
 * typed by the column and are fine. An ISO string plus an explicit cast keeps
 * the driver on a type it understands, and Postgres discards the offset when
 * casting to `timestamp` (no tz), so the stored value is byte-identical to
 * what drizzle's own mapper writes — verified, and independent of server TZ.
 */
export function timestampParam(date: Date): SQL {
  return sql`${date.toISOString()}::timestamp`;
}
