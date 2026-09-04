import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: {} }));

import { PAGE_SIZE } from "@/lib/admin/scope";
import {
  type AdminScope,
  DATE_ANCHORS,
  DEFAULT_SCOPE,
} from "@/lib/admin/scope-params";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  scopeConditions,
  ticketNumberFor,
  viewConditions,
} from "./admin-tickets";

const NOW = new Date("2026-09-04T12:00:00Z");
const scope = (over: Partial<AdminScope> = {}): AdminScope => ({
  ...DEFAULT_SCOPE,
  ...over,
});

/* Drizzle builds a tree, not a string, so these read the clause list rather
   than SQL text. That is enough to catch the whole class of bug this file kept
   shipping: a clause the pure layer computed and this layer never applied.
   Both blockers found in review were exactly that, and both were invisible to
   a test of the pure function alone. */
function clauseCount(s: AdminScope): number {
  return scopeConditions(s, NOW).length;
}

describe("every scope key reaches the query", () => {
  it.each([
    ["a brand", { brand: "3aac081f-cae5-446c-af3a-eaa2dfc3f916" }],
    ["a requester", { requester: "3aac081f-cae5-446c-af3a-eaa2dfc3f916" }],
    ["an assignee", { assignee: "3aac081f-cae5-446c-af3a-eaa2dfc3f916" }],
    ["the unassigned sentinel", { assignee: "unassigned" }],
    ["a status filter", { status: ["draft" as const] }],
    ["a text search", { q: "logo" }],
  ])("%s adds a condition", (_label, patch) => {
    expect(clauseCount(scope(patch))).toBeGreaterThan(clauseCount(scope()));
  });

  it("adds nothing for an empty search", () => {
    expect(clauseCount(scope({ q: "   " }))).toBe(clauseCount(scope()));
  });
});

describe("the date window is applied at both ends", () => {
  const base = () => clauseCount(scope({ range: "all" }));

  it("applies both bounds of a preset range", () => {
    expect(clauseCount(scope({ range: "7d" }))).toBe(base() + 2);
  });

  it("applies both bounds of a full custom range", () => {
    expect(
      clauseCount(
        scope({ range: "custom", from: "2026-07-19", to: "2026-07-25" }),
      ),
    ).toBe(base() + 2);
  });

  it("applies the lower bound of a start-only range", () => {
    expect(clauseCount(scope({ range: "custom", from: "2026-07-19" }))).toBe(
      base() + 2,
    );
  });

  /* The blocker: resolveWindow returned the upper bound correctly and the
     consumer guarded BOTH pushes on `window.from`, so an end-only range
     dropped its only bound. `?range=custom&to=2026-01-01` returned every
     ticket including today's. */
  it("applies the upper bound of an end-only range", () => {
    expect(clauseCount(scope({ range: "custom", to: "2026-07-25" }))).toBe(
      base() + 1,
    );
  });

  /* `all` must add NOTHING. An upper bound of `now` here hides every future
     due date the moment a caller anchors on `due`. */
  it("bounds nothing for the all range", () => {
    for (const on of DATE_ANCHORS) {
      expect(clauseCount(scope({ range: "all", on }))).toBe(
        clauseCount(scope({ range: "all" })),
      );
    }
  });
});

describe("the workload header and the overdue tab agree", () => {
  /* The blocker: overdue was counted INSIDE the active narrowing, so a
     designer's revision_requested ticket past its due date showed in the
     Overdue tab while the header above it reported none. `overdue` covers
     statuses `active` does not, so one can never be a subset of the other. */
  it("overdue is not a subset of active", () => {
    const active = viewConditions("active", NOW);
    const overdue = viewConditions("overdue", NOW);
    expect(overdue.length).toBeGreaterThan(0);
    expect(active.length).toBeGreaterThan(0);
    // Different clause shapes: one is a status allow-list, the other a
    // deny-list plus a date bound. Nesting them silently narrows the answer.
    expect(overdue.length).not.toBe(active.length);
  });
});

describe("paging contract", () => {
  /* The pager computes its page count from PAGE_SIZE and the query offsets by
     the same value. Diverging renders an empty last page under a non-zero
     total. */
  it("offsets by the same page size the pager counts with", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(PAGE_SIZE);
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
    expect(DEFAULT_SCOPE.on).toBe("created");
  });

  it("resolves every advertised anchor", () => {
    for (const on of DATE_ANCHORS) {
      expect(() =>
        scopeConditions(scope({ range: "7d", on }), NOW),
      ).not.toThrow();
    }
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

  it("declines a query with no digits at all", () => {
    expect(ticketNumberFor("logo refresh")).toBeNull();
  });

  it.each([
    ["DT-124", 124],
    ["124", 124],
    ["2147483647", 2_147_483_647],
  ])("reads %s as ticket %i", (q, n) => expect(ticketNumberFor(q)).toBe(n));

  /* Leading zeros are in range, not an overflow. */
  it("reads a zero-padded number rather than declining it", () => {
    expect(ticketNumberFor("000124")).toBe(124);
  });

  it("declines exactly one past the column's maximum", () => {
    expect(ticketNumberFor("2147483648")).toBeNull();
    expect(ticketNumberFor("2147483647")).toBe(2_147_483_647);
  });
});
