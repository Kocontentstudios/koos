/**
 * Pins the SQL `widenCalendarWindow` actually issues, by standing the queries
 * barrel on drizzle's pg-proxy driver — a real query builder with a function
 * where the network would be. Asserting the fragment builders alone left a
 * gap: inlining a raw Date back into queries/index.ts regressed the runtime
 * failure while every test stayed green.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

const seen: { sql: string; params: unknown[] }[] = [];

vi.mock("@/lib/db/client", async () => {
  const { drizzle: proxy } = await import("drizzle-orm/pg-proxy");
  const s = await import("@/lib/db/schema");
  return {
    db: proxy(
      async (sql: string, params: unknown[]) => {
        seen.push({ sql, params });
        return { rows: [] };
      },
      { schema: s },
    ),
  };
});

const { widenCalendarWindow, nextSortOrderForDate } = await import(
  "@/lib/db/queries"
);

const DATE = new Date("2026-12-20T00:00:00Z");
const ISO = "2026-12-20T00:00:00.000Z";

beforeEach(() => {
  seen.length = 0;
});

describe("widenCalendarWindow issues", () => {
  it("no raw Date in any parameter", async () => {
    await widenCalendarWindow("c1", DATE);
    expect(seen).toHaveLength(1);
    for (const p of seen[0].params) {
      expect(p).not.toBeInstanceOf(Date);
    }
  });

  it("a monotonic, guarded UPDATE against the calendars table", async () => {
    await widenCalendarWindow("c1", DATE);
    const { sql, params } = seen[0];
    expect(sql).toContain('update "calendars"');
    expect(sql).toContain("least");
    expect(sql).toContain("greatest");
    expect(sql).toContain("::timestamp");
    // Guard: skip entirely when the date already sits inside the window.
    expect(sql).toContain('< "calendars"."start_date"');
    expect(sql).toContain('> "calendars"."end_date"');
    expect(params).toContain(ISO);
    expect(params).toContain("c1");
  });

  it("binds the bound four times as the cast ISO string", async () => {
    await widenCalendarWindow("c1", DATE);
    const isoCount = seen[0].params.filter((p) => p === ISO).length;
    expect(isoCount).toBe(4);
  });
});

describe("nextSortOrderForDate", () => {
  /* Generation writes the first item of a day at sortOrder 0, so an empty day
     must also start at 0 — starting at 1 would order manual-only days after
     generated ones for no reason. */
  it("starts an empty day at 0", async () => {
    const n = await nextSortOrderForDate("c1", DATE);
    expect(n).toBe(0);
  });

  it("asks Postgres for the max on that calendar and day", async () => {
    await nextSortOrderForDate("c1", DATE);
    const { sql, params } = seen[0];
    expect(sql).toContain("max(");
    expect(sql).toContain('max("sort_order")');
    expect(sql).toContain('"calendar_items"."calendar_id"');
    expect(params).toContain("c1");
    for (const p of params) {
      expect(p).not.toBeInstanceOf(Date);
    }
  });
});

// Guards the assumption the proxy test rests on.
describe("schema shape", () => {
  it("keeps both window bounds on the calendars table", () => {
    expect(schema.calendars.startDate.name).toBe("start_date");
    expect(schema.calendars.endDate.name).toBe("end_date");
  });
});
