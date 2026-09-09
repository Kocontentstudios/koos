import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { widenWindowGuard, widenWindowSet } from "./calendar-window";
import { timestampParam } from "./timestamp";

const dialect = new PgDialect();
const DATE = new Date("2026-12-20T00:00:00Z");
const ISO = "2026-12-20T00:00:00.000Z";

/**
 * These assert the fragments the query actually ships (queries/index.ts
 * imports these exact builders). A raw Date interpolated into a fragment
 * bypasses drizzle's column type mapping and reaches postgres.js as a Date,
 * which dies at runtime with ERR_INVALID_ARG_TYPE — a failure the mocked
 * query-layer tests are structurally unable to see.
 */
describe("calendar window widen fragments", () => {
  it("binds the start bound as a cast ISO string, never a Date", () => {
    const q = dialect.sqlToQuery(widenWindowSet(DATE).startDate);
    expect(q.sql).toBe('least("calendars"."start_date", $1::timestamp)');
    expect(q.params).toEqual([ISO]);
    expect(q.params[0]).not.toBeInstanceOf(Date);
  });

  it("binds the end bound as a cast ISO string, never a Date", () => {
    const q = dialect.sqlToQuery(widenWindowSet(DATE).endDate);
    expect(q.sql).toBe('greatest("calendars"."end_date", $1::timestamp)');
    expect(q.params).toEqual([ISO]);
    expect(q.params[0]).not.toBeInstanceOf(Date);
  });

  it("binds both guard comparisons as cast ISO strings", () => {
    const q = dialect.sqlToQuery(widenWindowGuard(DATE));
    expect(q.sql).toBe(
      '($1::timestamp < "calendars"."start_date" OR $2::timestamp > "calendars"."end_date")',
    );
    expect(q.params).toEqual([ISO, ISO]);
  });

  it("puts no raw Date anywhere in the shipped widen", () => {
    const fragments = [
      widenWindowSet(DATE).startDate,
      widenWindowSet(DATE).endDate,
      widenWindowGuard(DATE),
    ];
    for (const f of fragments) {
      for (const p of dialect.sqlToQuery(f).params) {
        expect(p).not.toBeInstanceOf(Date);
        expect(typeof p).toBe("string");
      }
    }
  });

  // least/greatest are what make a stale concurrent widen unable to shrink the
  // window; a plain assignment would reintroduce the lost-update race.
  it("widens monotonically in both directions", () => {
    expect(dialect.sqlToQuery(widenWindowSet(DATE).startDate).sql).toContain(
      "least",
    );
    expect(dialect.sqlToQuery(widenWindowSet(DATE).endDate).sql).toContain(
      "greatest",
    );
  });
});

describe("timestampParam", () => {
  it("emits an explicit cast so Postgres reads it as a timestamp", () => {
    const q = dialect.sqlToQuery(timestampParam(DATE));
    expect(q.sql).toBe("$1::timestamp");
    expect(q.params).toEqual([ISO]);
  });
});
