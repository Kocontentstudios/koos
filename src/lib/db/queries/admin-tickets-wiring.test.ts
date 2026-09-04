import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordingDb } from "./query-recorder";

/* The query builders were never invoked by any test — `db` was mocked as `{}`
   and only the pure helpers were called. Every join, where, limit, offset and
   orderBy was unexecuted, so `.where(undefined)` (every drill-down returns the
   whole table) passed the full suite. This file runs them for real against a
   recorder. */
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

import { PAGE_SIZE, VIEW_PREDICATES } from "@/lib/admin/scope";
import { type AdminScope, DEFAULT_SCOPE } from "@/lib/admin/scope-params";
import {
  countAdminTickets,
  getWorkloadForDesigner,
  listAdminTickets,
} from "./admin-tickets";

const NOW = new Date("2026-09-04T12:00:00Z");
const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const DESIGNER = "11111111-1111-1111-1111-111111111111";
const scope = (over: Partial<AdminScope> = {}): AdminScope => ({
  ...DEFAULT_SCOPE,
  ...over,
});

let rec: ReturnType<typeof recordingDb>;
beforeEach(() => {
  rec = recordingDb([]);
  setCurrent(rec as unknown as { db: Record<string, unknown> });
});

describe("listAdminTickets", () => {
  /* The mutation that hid best: `.where(undefined)` turns every drill-down
     into "select everything". */
  it("always constrains the query", async () => {
    for (const view of [
      "open",
      "overdue",
      "awaiting_review",
      "approved",
    ] as const) {
      rec = recordingDb([]);
      setCurrent(rec as unknown as { db: Record<string, unknown> });
      await listAdminTickets(scope({ view }), { now: NOW });
      expect(rec.recorded.where, `${view} must be constrained`).toBeDefined();
    }
  });

  it("carries the view's predicate into the WHERE", async () => {
    await listAdminTickets(scope({ view: "overdue" }), { now: NOW });
    const sql = rec.recorded.where?.sql ?? "";
    expect(sql).toContain('"design_tickets"."due_date" <');
    expect(sql).toContain('"design_tickets"."status" not in');
    for (const s of VIEW_PREDICATES.overdue.statusNotIn ?? []) {
      expect(rec.recorded.where?.params).toContain(s);
    }
  });

  it("selects from design_tickets", async () => {
    await listAdminTickets(scope(), { now: NOW });
    expect(rec.recorded.from).toBe("design_tickets");
  });

  /* Every column the row mapping reads has to be projected, and has to come
     from the TABLE it claims. Asserting the column name alone cannot catch a
     swapped source: brands.name and strategies.name are both called "name", so
     the queue would print the campaign where the brand belongs and the
     assertion would still pass. */
  it("projects each column from its own table", async () => {
    await listAdminTickets(scope(), { now: NOW });
    expect(rec.recorded.sources).toMatchObject({
      id: "design_tickets.id",
      ticketNumber: "design_tickets.ticket_number",
      title: "design_tickets.title",
      brief: "design_tickets.brief",
      designType: "design_tickets.design_type",
      dimensions: "design_tickets.dimensions",
      slides: "design_tickets.slides",
      status: "design_tickets.status",
      priority: "design_tickets.priority",
      dueDate: "design_tickets.due_date",
      approvedAt: "design_tickets.approved_at",
      brandId: "design_tickets.brand_id",
      brandName: "brands.name",
      campaignName: "strategies.name",
      itemTitle: "calendar_items.title",
      designerId: "design_tickets.assigned_designer_id",
      designerFirstName: "designer.first_name",
      designerLastName: "designer.last_name",
      designerEmail: "designer.email",
    });
  });

  /* The two that are indistinguishable by column name. */
  it("does not confuse the brand name with the campaign name", async () => {
    await listAdminTickets(scope(), { now: NOW });
    expect(rec.recorded.sources.brandName).toBe("brands.name");
    expect(rec.recorded.sources.campaignName).toBe("strategies.name");
    expect(rec.recorded.sources.brandName).not.toBe(
      rec.recorded.sources.campaignName,
    );
  });

  /* The pager counts pages with PAGE_SIZE; the query has to offset by the same
     number or the last page renders empty under a non-zero total. */
  it("pages by the same size the pager counts with", async () => {
    await listAdminTickets(scope({ page: 1 }), { now: NOW });
    expect(rec.recorded.limit).toBe(PAGE_SIZE);
    expect(rec.recorded.offset).toBe(0);
  });

  it.each([
    [2, PAGE_SIZE],
    [3, PAGE_SIZE * 2],
    [10, PAGE_SIZE * 9],
  ])("offsets page %i by %i", async (page, offset) => {
    await listAdminTickets(scope({ page }), { now: NOW });
    expect(rec.recorded.offset).toBe(offset);
  });

  it("orders by something, ending in a unique tiebreak", async () => {
    await listAdminTickets(scope({ view: "overdue" }), { now: NOW });
    expect(rec.recorded.orderBy.length).toBeGreaterThan(1);
    expect(rec.recorded.orderBy.at(-1)).toBe('"design_tickets"."id" asc');
  });

  it("joins what the row mapping reads", async () => {
    await listAdminTickets(scope(), { now: NOW });
    for (const table of [
      "brands",
      "calendar_items",
      "calendars",
      "strategies",
    ]) {
      expect(rec.recorded.joins).toContain(table);
    }
  });

  /* The requester join exists only to widen the text search. Paying for it on
     every drill-down is the cost the count query already documents avoiding. */
  it("joins the requester only when searching", async () => {
    await listAdminTickets(scope({ q: "logo" }), { now: NOW });
    expect(rec.recorded.joins).toContain("requester");

    rec = recordingDb([]);
    setCurrent(rec as unknown as { db: Record<string, unknown> });
    await listAdminTickets(scope(), { now: NOW });
    expect(rec.recorded.joins).not.toContain("requester");
    // The designer join IS always needed — the row renders the assignee.
    expect(rec.recorded.joins).toContain("designer");
  });
});

describe("countAdminTickets", () => {
  it("always constrains the query", async () => {
    await countAdminTickets(scope({ view: "overdue" }), { now: NOW });
    expect(rec.recorded.where).toBeDefined();
    expect(rec.recorded.where?.sql).toContain('"design_tickets"."due_date" <');
  });

  it("counts the same rows the list would return", async () => {
    await countAdminTickets(scope({ view: "awaiting_review", brand: BRAND }), {
      now: NOW,
    });
    const countWhere = rec.recorded.where?.sql;

    rec = recordingDb([]);
    setCurrent(rec as unknown as { db: Record<string, unknown> });
    await listAdminTickets(scope({ view: "awaiting_review", brand: BRAND }), {
      now: NOW,
    });
    expect(countWhere).toBe(rec.recorded.where?.sql);
  });

  it("pays for no join it does not need", async () => {
    await countAdminTickets(scope(), { now: NOW });
    expect(rec.recorded.joins).toEqual([]);
  });

  it("joins for a text search", async () => {
    await countAdminTickets(scope({ q: "logo" }), { now: NOW });
    expect(rec.recorded.joins).toContain("brands");
    expect(rec.recorded.joins).toContain("requester");
  });

  it("does not page — a count is over the whole set", async () => {
    await countAdminTickets(scope({ page: 4 }), { now: NOW });
    expect(rec.recorded.limit).toBeUndefined();
    expect(rec.recorded.offset).toBeUndefined();
  });
});

describe("getWorkloadForDesigner", () => {
  it("scopes to the designer and nothing else", async () => {
    await getWorkloadForDesigner(DESIGNER, NOW);
    const where = rec.recorded.where;
    expect(where?.sql).toContain('"design_tickets"."assigned_designer_id" =');
    expect(where?.params).toContain(DESIGNER);
    // The two counts are filters in the projection, not extra WHERE clauses.
    expect(where?.sql).not.toContain('"design_tickets"."status"');
  });

  it("projects both counts", async () => {
    await getWorkloadForDesigner(DESIGNER, NOW);
    expect(Object.keys(rec.recorded.select ?? {}).sort()).toEqual([
      "active",
      "overdue",
    ]);
  });

  /* The fragments are asserted elsewhere; this pins the MAPPING. Returning
     `active: row.overdue` renders "2 active · 7 overdue" for a designer
     carrying 7 and 2, and every SQL assertion still passes. */
  it("returns each count under its own name", async () => {
    rec = recordingDb([{ active: 7, overdue: 2 }]);
    setCurrent(rec as unknown as { db: Record<string, unknown> });
    expect(await getWorkloadForDesigner(DESIGNER, NOW)).toEqual({
      active: 7,
      overdue: 2,
    });
  });

  /* Postgres returns count(*) as a string over the wire. */
  it("coerces the aggregate strings to numbers", async () => {
    rec = recordingDb([{ active: "7", overdue: "2" }]);
    setCurrent(rec as unknown as { db: Record<string, unknown> });
    expect(await getWorkloadForDesigner(DESIGNER, NOW)).toEqual({
      active: 7,
      overdue: 2,
    });
  });

  it("reports zeroes when the designer has nothing", async () => {
    rec = recordingDb([]);
    setCurrent(rec as unknown as { db: Record<string, unknown> });
    expect(await getWorkloadForDesigner(DESIGNER, NOW)).toEqual({
      active: 0,
      overdue: 0,
    });
  });
});
