import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordingDb } from "./query-recorder";

const { dbProxy, setCurrent } = vi.hoisted(() => {
  let current: { db: Record<string, unknown> };
  return {
    dbProxy: new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => current.db[prop as string],
    }),
    setCurrent: (next: { db: Record<string, unknown> }) => {
      current = next;
    },
  };
});

vi.mock("@/lib/db/client", () => ({ db: dbProxy }));

import { PAGE_SIZE } from "@/lib/admin/scope";
import type { AnalyticsFilter } from "@/lib/analytics/filter";
import {
  countApprovalRecords,
  countBrandRecords,
  countGenerationRecords,
  countTicketRecords,
  countUserRecords,
  getActiveBrandCount,
  getApprovalDurations,
  getSignups,
  getTickets,
  getTopBrandsByActivity,
  getUsageEvents,
  listApprovalRecords,
  listBrandRecords,
  listGenerationRecords,
  listTicketRecords,
  listUserRecords,
  MAX_ROWS,
} from "./analytics";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const FROM = new Date("2026-08-01T00:00:00Z");
const TO = new Date("2026-09-01T00:00:00Z");

const filter = (over: Partial<AnalyticsFilter> = {}): AnalyticsFilter => ({
  from: FROM,
  to: TO,
  kinds: [],
  statuses: [],
  brandId: null,
  periodDays: 31,
  explicitFrom: false,
  explicitTo: false,
  ...over,
});

let rec: ReturnType<typeof recordingDb>;
beforeEach(() => {
  rec = recordingDb([]);
  setCurrent(rec as unknown as { db: Record<string, unknown> });
});

const sql = () => rec.recorded.where?.sql ?? "";
const params = () => rec.recorded.where?.params ?? [];

/* Before ADMIN-FEAT-005 each query took a bare `since` and every card carried
   its own hardcoded window, so one control could not move them together. These
   assert that the whole filter reaches SQL — and, just as important, that each
   query applies only the parts that mean something for it. */
describe("the window reaches every query", () => {
  it.each([
    ["usage events", getUsageEvents, '"usage_events"."created_at"'],
    ["signups", getSignups, '"users"."created_at"'],
    ["tickets", getTickets, '"design_tickets"."created_at"'],
  ])("%s", async (_label, fn, column) => {
    await fn(filter());
    expect(sql()).toContain(`${column} >=`);
    // `to` is exclusive by contract — see resolveWindow.
    expect(sql()).toContain(`${column} < `);
    expect(sql()).not.toContain(`${column} <=`);
  });

  it("bounds nothing for an unbounded range", async () => {
    await getUsageEvents(filter({ from: null, to: null }));
    expect(sql()).not.toContain('"usage_events"."created_at"');
  });

  it("applies an upper bound with no lower one", async () => {
    await getUsageEvents(filter({ from: null }));
    expect(sql()).toContain('"usage_events"."created_at" < ');
    expect(sql()).not.toContain('"usage_events"."created_at" >=');
  });
});

describe("each query applies only the filters that mean something for it", () => {
  it("narrows generations by activity type and brand", async () => {
    await getUsageEvents(
      filter({ kinds: ["design_generated"], brandId: BRAND }),
    );
    expect(sql()).toContain('"usage_events"."kind" in');
    expect(params()).toContain("design_generated");
    expect(sql()).toContain('"usage_events"."brand_id" =');
    expect(params()).toContain(BRAND);
  });

  it("narrows tickets by status and brand", async () => {
    await getTickets(filter({ statuses: ["delivered"], brandId: BRAND }));
    expect(sql()).toContain('"design_tickets"."status" in');
    expect(params()).toContain("delivered");
    expect(sql()).toContain('"design_tickets"."brand_id" =');
  });

  /* A signup belongs to no brand and has no ticket status. Applying those
     filters would zero this card the moment an operator filtered by brand, and
     the zero would look like an answer rather than a category error. */
  it("does not narrow signups by brand, status or activity type", async () => {
    await getSignups(
      filter({
        brandId: BRAND,
        statuses: ["delivered"],
        kinds: ["design_generated"],
      }),
    );
    expect(params()).not.toContain(BRAND);
    expect(params()).not.toContain("delivered");
    expect(params()).not.toContain("design_generated");
    expect(sql()).toContain('"users"."created_at"');
  });

  it("narrows the active-brand count the same way as generations", async () => {
    await getActiveBrandCount(filter({ kinds: ["calendar_generated"] }));
    expect(params()).toContain("calendar_generated");
    expect(sql()).toContain('"usage_events"."brand_id" is not null');
  });

  it("narrows the brand leaderboard the same way as generations", async () => {
    await getTopBrandsByActivity(filter({ kinds: ["strategy_generated"] }));
    expect(params()).toContain("strategy_generated");
  });

  /* Time to approval is a ticket metric, so a status filter is meaningful —
     but it must still only count tickets that were actually approved. */
  it("counts only approved tickets for the approval metric", async () => {
    await getApprovalDurations(filter());
    expect(sql()).toContain('"design_tickets"."approved_at" is not null');
  });
});

describe("the record lists are ordered and paged deterministically", () => {
  it.each([
    ["generations", listGenerationRecords, "usage_events"],
    ["users", listUserRecords, "users"],
    ["approvals", listApprovalRecords, "design_tickets"],
    ["brands", listBrandRecords, "usage_events"],
  ])("%s", async (_label, fn, table) => {
    await fn(filter(), PAGE_SIZE, PAGE_SIZE * 2);
    expect(rec.recorded.from).toBe(table);
    expect(rec.recorded.limit).toBe(PAGE_SIZE);
    expect(rec.recorded.offset).toBe(PAGE_SIZE * 2);
    /* Without a unique tiebreak, rows that tie on the sort column come back in
       whatever order the plan produced, so paging can repeat one and drop
       another. */
    expect(rec.recorded.orderBy.at(-1)).toMatch(/\."id" asc$/);
  });

  /* Every metric, not just one. The header count and the rows below it are two
     queries; if they diverge, the page prints "412 records" above 8 rows, which
     is the exact invariant FEAT-003 exists to establish. */
  it.each([
    ["generations", listGenerationRecords, countGenerationRecords],
    ["users", listUserRecords, countUserRecords],
    ["tickets", listTicketRecords, countTicketRecords],
    ["approvals", listApprovalRecords, countApprovalRecords],
  ])("%s counts the same rows it lists", async (_label, list, countFn) => {
    const f = filter({
      kinds: ["design_generated"],
      statuses: ["delivered"],
      brandId: BRAND,
    });
    await list(f);
    const listWhere = sql();

    rec = recordingDb([]);
    setCurrent(rec as unknown as { db: Record<string, unknown> });
    await countFn(f);
    expect(sql()).toBe(listWhere);
  });

  /* Brands is the odd one: it LISTS grouped brands and must COUNT distinct
     brands, not the events underneath them. */
  it("counts brands, not the events they generated", async () => {
    await countBrandRecords(filter());
    expect(rec.recorded.select).toBeDefined();
    const projection = JSON.stringify(rec.recorded.sources);
    expect(projection).toContain("brand_id");
  });

  it("applies the same filter to the brand list and its count", async () => {
    const f = filter({ kinds: ["design_generated"] });
    await listBrandRecords(f);
    const listWhere = sql();

    rec = recordingDb([]);
    setCurrent(rec as unknown as { db: Record<string, unknown> });
    await countBrandRecords(f);
    expect(sql()).toBe(listWhere);
  });

  /* The approval metric must never count a ticket that was not approved —
     dropping that clause inflates the header over the rows. */
  it("counts only approved tickets in the approval header", async () => {
    await countApprovalRecords(filter());
    expect(sql()).toContain('"design_tickets"."approved_at" is not null');
  });

  /* A capped fetch keeps the NEWEST rows, not an arbitrary sample: the chart,
     the breakdowns and the time-to-approval median are computed from them. */
  it.each([
    ["generations", getUsageEvents, '"usage_events"."created_at" desc'],
    ["signups", getSignups, '"users"."created_at" desc'],
    ["tickets", getTickets, '"design_tickets"."created_at" desc'],
  ])("%s orders before capping", async (_label, fn, expected) => {
    await fn(filter());
    expect(rec.recorded.orderBy[0]).toBe(expected);
    expect(rec.recorded.limit).toBe(MAX_ROWS);
  });

  /* The one the module comment names: the MEDIAN is computed from these rows,
     so both the cap and the order matter more here than anywhere else. */
  it("orders and caps the rows the median is computed from", async () => {
    await getApprovalDurations(filter());
    expect(rec.recorded.orderBy[0]).toBe('"design_tickets"."approved_at" desc');
    expect(rec.recorded.limit).toBe(MAX_ROWS);
  });

  /* Time to approval is windowed on when a ticket was APPROVED. Windowing on
     created_at hides a ticket created in August and signed off today, and
     biases the metric: a 7-day window could only contain fast approvals. */
  it("windows approvals on the approval date, not the creation date", async () => {
    await getApprovalDurations(filter());
    expect(sql()).toContain('"design_tickets"."approved_at" >=');
    expect(sql()).not.toContain('"design_tickets"."created_at" >=');
  });

  it("windows the approval records and their count the same way", async () => {
    await listApprovalRecords(filter());
    const listWhere = sql();
    rec = recordingDb([]);
    setCurrent(rec as unknown as { db: Record<string, unknown> });
    await countApprovalRecords(filter());
    expect(sql()).toBe(listWhere);
    expect(sql()).toContain('"design_tickets"."approved_at" >=');
  });

  /* The brand leaderboard aggregates, so every non-aggregated projected column
     has to be grouped or Postgres raises 42803 at runtime. */
  it("groups the brand records by everything it projects", async () => {
    await listBrandRecords(filter());
    for (const column of [
      "brands.id",
      "brands.name",
      "users.email",
      "users.first_name",
      "users.last_name",
    ]) {
      expect(rec.recorded.groupBy).toContain(column);
    }
  });

  /* max(created_at) through a raw fragment needs .mapWith, or postgres-js
     returns the wire string and the date renders in the wrong zone. */
  it("decodes the last-active date as a date", async () => {
    await listBrandRecords(filter());
    const shape = rec.recorded.select ?? {};
    expect(
      (shape.lastActiveAt as { decoder?: unknown } | undefined)?.decoder,
    ).toBeDefined();
  });
});
