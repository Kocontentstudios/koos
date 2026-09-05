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
  countBrandSetupRecords,
  countCalendarRecords,
  countCampaignRecords,
  countDeliveryRecords,
  countGenerationRecords,
  countRevisionRecords,
  countTicketRecords,
  countUserRecords,
  getActiveBrandCount,
  getApprovalDurations,
  getApprovalRate,
  getBrandSetupRows,
  getCalendarActivityCount,
  getCampaignCount,
  getRevisionRequestCount,
  getSignups,
  getTickets,
  getTopBrandsByActivity,
  getUsageEvents,
  listApprovalRecords,
  listBrandRecords,
  listBrandSetupRecords,
  listCalendarRecords,
  listCampaignRecords,
  listDeliveryRecords,
  listGenerationRecords,
  listRevisionRecords,
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

/* ── ADMIN-FEAT-004 ────────────────────────────────────────────────────── */

/* Each new metric reads a DIFFERENT table on a different timestamp. Getting the
   column wrong is invisible in a mocked test unless the compiled WHERE is read:
   windowing calendar activity on design_tickets.created_at would still return
   rows, just the wrong ones. */
describe("every new metric windows its own table", () => {
  it.each([
    ["campaigns", getCampaignCount, '"strategies"."created_at"'],
    ["calendar", getCalendarActivityCount, '"calendar_items"."created_at"'],
    ["revisions", getRevisionRequestCount, '"ticket_updates"."created_at"'],
    ["brand setup", getBrandSetupRows, '"brands"."created_at"'],
  ])("%s", async (_label, fn, column) => {
    await fn(filter());
    expect(sql()).toContain(`${column} >=`);
    expect(sql()).toContain(`${column} < `);
    expect(sql()).not.toContain(`${column} <=`);
  });

  /* The approval RATE is windowed on delivery, not creation: "of the work
     handed over in this window, how much came back approved". Windowing on
     created_at answers a different question and biases the rate toward fast
     jobs, which are the only ones that can be created and delivered inside one
     short window. */
  it("windows the approval rate on delivery", async () => {
    await getApprovalRate(filter());
    expect(sql()).toContain('"design_tickets"."delivered_at" >=');
    expect(sql()).not.toContain('"design_tickets"."created_at" >=');
  });

  it("counts only tickets that were actually delivered", async () => {
    await getApprovalRate(filter());
    expect(sql()).toContain('"design_tickets"."delivered_at" is not null');
  });
});

/* A ticket revised three times is three revision requests. Counting DISTINCT
   tickets would report it once, and counting tickets by current status would
   lose it entirely the moment the status moved on. */
describe("revisions are counted as events", () => {
  it("filters on the status the update RECORDED, not the ticket's own", async () => {
    await getRevisionRequestCount(filter());
    expect(sql()).toContain('"ticket_updates"."new_status" =');
    expect(params()).toContain("revision_requested");
    expect(sql()).not.toContain('"design_tickets"."status" =');
  });

  it("does not deduplicate by ticket", async () => {
    await getRevisionRequestCount(filter());
    expect(rec.recorded.groupBy).toEqual([]);
    expect(Object.values(rec.recorded.sources).join(" ")).not.toMatch(
      /distinct/i,
    );
  });
});

describe("the brand filter reaches every metric that claims to honour it", () => {
  it.each([
    ["campaigns", getCampaignCount, '"strategies"."brand_id"'],
    /* calendar_items carries no brand of its own; it reaches one through its
       calendar, so this is the join as much as the filter. */
    ["calendar", getCalendarActivityCount, '"calendars"."brand_id"'],
    ["revisions", getRevisionRequestCount, '"design_tickets"."brand_id"'],
    ["approval rate", getApprovalRate, '"design_tickets"."brand_id"'],
    /* METRIC_FILTERS says brand narrows brand setup, so the query must apply
       it — otherwise the header claims a narrowing that never happened. */
    ["brand setup", getBrandSetupRows, '"brands"."id" ='],
  ])("%s", async (_label, fn, fragment) => {
    await fn(filter({ brandId: BRAND }));
    expect(sql()).toContain(fragment);
    expect(params()).toContain(BRAND);
  });

  it("leaves the brand out entirely when none is selected", async () => {
    await getCampaignCount(filter());
    expect(sql()).not.toContain('"strategies"."brand_id"');
  });
});

/* The ticket status IS the outcome the rate measures. Applying the status
   filter would move numerator and denominator together and pin the rate at
   100% or 0% — see METRIC_FILTERS, which declares this metric status-blind. */
describe("the approval rate ignores the ticket status filter", () => {
  it("does not narrow its own population by status", async () => {
    await getApprovalRate(filter({ statuses: ["delivered"] }));
    expect(sql()).not.toContain('"design_tickets"."status" in');
  });

  it("still counts the approved ones as its numerator", async () => {
    await getApprovalRate(filter());
    /* A conditional aggregate, not a second query: the numerator has to be
       counted over the SAME rows as the denominator, or a row can land in one
       and not the other. */
    expect(rec.recorded.sources.approved).toContain("filter (where");
    expect(rec.recorded.sources.approved).toContain("'delivered'");
  });
});

describe("a rate is never invented from an empty population", () => {
  it("returns null rather than zero when nothing was delivered", async () => {
    rec = recordingDb([{ delivered: 0, approved: 0 }]);
    setCurrent(rec as unknown as { db: Record<string, unknown> });
    expect((await getApprovalRate(filter())).rate).toBeNull();
  });

  it("computes a percentage when there is a population", async () => {
    rec = recordingDb([{ delivered: 8, approved: 6 }]);
    setCurrent(rec as unknown as { db: Record<string, unknown> });
    expect((await getApprovalRate(filter())).rate).toBeCloseTo(75);
  });

  /* No row at all (a filter matching nothing) must behave like an empty
     population, not throw on a missing property. */
  it("survives the query returning no row", async () => {
    rec = recordingDb([]);
    setCurrent(rec as unknown as { db: Record<string, unknown> });
    const result = await getApprovalRate(filter());
    expect(result).toEqual({ delivered: 0, approved: 0, rate: null });
  });
});

/* Every capped or paginated fetch is ORDERED. Without it the rows kept are
   whatever the plan produced, so page 2 can repeat page 1. */
describe("the new record lists are ordered and paginated", () => {
  it.each([
    ["campaigns", listCampaignRecords, '"strategies"."created_at" desc'],
    ["calendar", listCalendarRecords, '"calendar_items"."created_at" desc'],
    ["deliveries", listDeliveryRecords, '"design_tickets"."delivered_at" desc'],
    ["revisions", listRevisionRecords, '"ticket_updates"."created_at" desc'],
    ["brand setup", listBrandSetupRecords, '"brands"."created_at" desc'],
  ])("%s", async (_label, fn, order) => {
    await fn(filter(), PAGE_SIZE, PAGE_SIZE);
    expect(rec.recorded.orderBy[0]).toBe(order);
    // A tiebreak, or rows tied on the timestamp can swap between pages.
    expect(rec.recorded.orderBy).toHaveLength(2);
    expect(rec.recorded.limit).toBe(PAGE_SIZE);
    expect(rec.recorded.offset).toBe(PAGE_SIZE);
  });

  it("caps the brand setup rows the average is computed from", async () => {
    await getBrandSetupRows(filter());
    expect(rec.recorded.limit).toBe(MAX_ROWS);
  });
});

/* A list and its count that resolve different WHERE clauses show a total the
   rows cannot add up to, and a pager that walks off the end of a shorter list. */
describe("each new list agrees with its own count", () => {
  it.each([
    ["campaigns", listCampaignRecords, countCampaignRecords],
    ["calendar", listCalendarRecords, countCalendarRecords],
    ["deliveries", listDeliveryRecords, countDeliveryRecords],
    ["revisions", listRevisionRecords, countRevisionRecords],
    ["brand setup", listBrandSetupRecords, countBrandSetupRecords],
  ])("%s", async (_label, list, countFn) => {
    const f = filter({ brandId: BRAND, statuses: ["delivered"] });
    await list(f);
    const listWhere = sql();
    rec = recordingDb([]);
    setCurrent(rec as unknown as { db: Record<string, unknown> });
    await countFn(f);
    expect(sql()).toBe(listWhere);
  });
});
