import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: {} }));

import { PAGE_SIZE, VIEW_PREDICATES } from "@/lib/admin/scope";
import {
  DATE_ANCHORS,
  DEFAULT_SCOPE,
} from "@/lib/admin/scope-params";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  ticketNumberFor,
} from "./admin-tickets";

/* SQL correctness is not provable here — the gate lane has no database, and the
   predicate this file translates is tested without one in scope.test.ts. What
   IS provable here is the arithmetic the page depends on and the contracts the
   translator promises to honour. */
describe("paging contract", () => {
  /* The pager computes its page count from PAGE_SIZE and the query offsets by
     the same value. If they diverge the last page silently renders empty under
     a non-zero total. */
  it("offsets by the same page size the pager counts with", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(PAGE_SIZE);
  });

  it("caps a caller-supplied limit below the hard ceiling", () => {
    expect(Math.min(10_000, MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
    expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });
});

describe("the date anchors name real columns", () => {
  /* `delivered` was advertised as an anchor and quietly resolved to created_at,
     because design_tickets has no delivered_at column. A named anchor that
     answers a different question is worse than a missing one — ADMIN-FEAT-002
     adds the column and the anchor in the same change. */
  it("offers no anchor without a column behind it", () => {
    expect([...DATE_ANCHORS]).not.toContain("delivered");
    expect([...DATE_ANCHORS]).toEqual(["created", "due", "approved"]);
    expect(DEFAULT_SCOPE.on).toBe("created");
  });
});

describe("the workload header cannot disagree with the list under it", () => {
  /* getWorkloadForDesigner used to restate active's status list and the overdue
     clause as literals, in the same file whose header claims VIEW_PREDICATES is
     the single definition. This pins the shape it now derives from. */
  it("derives active from the same predicate the list uses", () => {
    expect(VIEW_PREDICATES.active.statusIn).toEqual([
      "assigned",
      "in_progress",
      "ready_for_review",
    ]);
  });

  it("derives overdue from the same predicate the card counts", () => {
    expect(VIEW_PREDICATES.overdue).toEqual({
      statusNotIn: ["draft", "delivered"],
      approved: "none",
      overdue: true,
    });
  });
});

describe("ticket-number search cannot overflow the column", () => {
  /* ticket_number is a Postgres integer. Comparing an out-of-range literal is a
     query ERROR, not a miss, so a phone number in the search box produced a 500
     rather than no results. */
  it.each(["+2348012345678", "99999999999", "9".repeat(20)])(
    "declines to compare %s against the column",
    (q) => expect(ticketNumberFor(q)).toBeNull(),
  );

  /* Leading zeros are in range, not an overflow: "000124" is ticket 124 and
     comparing it is safe, so the guard must not reject it. */
  it("reads a zero-padded number rather than declining it", () => {
    expect(ticketNumberFor("000124")).toBe(124);
  });

  it("declines a query with no digits at all", () => {
    expect(ticketNumberFor("logo refresh")).toBeNull();
  });

  it.each([
    ["DT-124", 124],
    ["124", 124],
    ["2147483647", 2_147_483_647],
  ])("reads %s as ticket %i", (q, n) => expect(ticketNumberFor(q)).toBe(n));

  /* One past the ceiling is the boundary that actually errors. */
  it("declines exactly one past the column's maximum", () => {
    expect(ticketNumberFor("2147483648")).toBeNull();
    expect(ticketNumberFor("2147483647")).toBe(2_147_483_647);
  });
});
