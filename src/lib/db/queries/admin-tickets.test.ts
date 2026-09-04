import { and, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: {} }));

import {
  ADMIN_TICKET_VIEWS,
  matchesView,
  VIEW_PREDICATES,
} from "@/lib/admin/scope";
import {
  type AdminScope,
  DATE_ANCHORS,
  DEFAULT_SCOPE,
} from "@/lib/admin/scope-params";
import { TICKET_STATUSES } from "@/lib/design/tickets-ui";
import {
  orderFor,
  scopeConditions,
  ticketNumberFor,
  workloadCounts,
} from "./admin-tickets";

const NOW = new Date("2026-09-04T12:00:00Z");
const scope = (over: Partial<AdminScope> = {}): AdminScope => ({
  ...DEFAULT_SCOPE,
  ...over,
});

/**
 * The compiled SQL, as text.
 *
 * The previous version of this file counted clauses and compared counts
 * RELATIVELY (`patched > base`). Mutation testing found that worthless:
 * replacing `viewConditions(...)` with `[]` makes every drill-down return the
 * entire table, moves both sides of every comparison equally, and passes the
 * whole suite. Assertions have to name the SQL that must be there.
 */
const dialect = new PgDialect();

function compileScope(s: AdminScope): { sql: string; params: unknown[] } {
  const conditions = scopeConditions(s, NOW);
  const combined = conditions.length ? and(...conditions) : undefined;
  if (!combined) return { sql: "", params: [] };
  return dialect.sqlToQuery(combined);
}

const sqlFor = (s: AdminScope) => compileScope(s).sql;
const paramsFor = (s: AdminScope) => compileScope(s).params;

/**
 * The claim this whole file rests on: the SQL translator agrees with
 * `matchesView`. They are two independent implementations of `VIEW_PREDICATES`
 * and nothing used to compare them, so mutating the translator — inverting
 * `lt` to `gte`, swapping `isNull` for `isNotNull`, or dropping the view
 * clauses entirely so every drill-down returns the whole table — passed the
 * entire suite.
 *
 * Expectations are DERIVED from the predicate map rather than written out, so
 * a new view cannot be added without its translation being checked.
 */
describe("the translator emits the SQL its predicate names", () => {
  it.each([...ADMIN_TICKET_VIEWS])("%s", (view) => {
    const p = VIEW_PREDICATES[view];
    const sql = sqlFor(scope({ view }));
    const params = paramsFor(scope({ view }));

    if (p.statusIn) {
      expect(sql).toContain('"design_tickets"."status" in');
      for (const status of p.statusIn) expect(params).toContain(status);
    }
    if (p.statusNotIn) {
      expect(sql).toContain('"design_tickets"."status" not in');
      for (const status of p.statusNotIn) expect(params).toContain(status);
    }
    if (p.approved === "none")
      expect(sql).toContain('"design_tickets"."approved_at" is null');

    // The direction matters: `>=` here returns every NOT-yet-due ticket.
    if (p.overdue) expect(sql).toContain('"design_tickets"."due_date" <');

    // A predicate that names anything must reach SQL. This is the assertion
    // that fails when the view conditions are dropped on the floor.
    const names = Boolean(
      p.statusIn || p.statusNotIn || p.approved || p.overdue,
    );
    expect(sql.length > 0).toBe(names);
  });

  /* Belt and braces on the mutation that hid best: `all` is the ONLY view
     allowed to compile to nothing. */
  it("only the all view is unconstrained", () => {
    const unconstrained = ADMIN_TICKET_VIEWS.filter(
      (view) => sqlFor(scope({ view })) === "",
    );
    expect(unconstrained).toEqual(["all"]);
  });

  /* Neither implementation may quietly stop mentioning a status the other
     still filters on. */
  it.each([...ADMIN_TICKET_VIEWS])(
    "%s agrees with matchesView about which statuses it admits",
    (view) => {
      const params = paramsFor(scope({ view }));
      for (const status of TICKET_STATUSES) {
        const admitted = matchesView(
          { status, approvedAt: null, dueDate: null },
          view,
          NOW,
        );
        const p = VIEW_PREDICATES[view];
        // A status the JS predicate rejects on status alone must appear in the
        // SQL's status list (as an exclusion or an omission from the allow-list).
        if (!admitted && !p.overdue) {
          if (p.statusNotIn) expect(params).toContain(status);
          else if (p.statusIn) expect(params).not.toContain(status);
        }
      }
    },
  );
});

describe("every scope key reaches the query", () => {
  it("filters by brand", () => {
    const id = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
    expect(sqlFor(scope({ brand: id }))).toContain(
      '"design_tickets"."brand_id" =',
    );
    expect(paramsFor(scope({ brand: id }))).toContain(id);
  });

  it("filters by requester", () => {
    const id = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
    expect(sqlFor(scope({ requester: id }))).toContain(
      '"design_tickets"."user_id" =',
    );
  });

  it("filters by assignee", () => {
    const id = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
    expect(sqlFor(scope({ assignee: id }))).toContain(
      '"design_tickets"."assigned_designer_id" =',
    );
  });

  /* The sentinel is a NULL test, never a comparison — a uuid column cannot be
     compared to the string "unassigned". */
  it("reads the unassigned sentinel as a null test", () => {
    const sql = sqlFor(scope({ assignee: "unassigned" }));
    expect(sql).toContain('"design_tickets"."assigned_designer_id" is null');
    expect(paramsFor(scope({ assignee: "unassigned" }))).not.toContain(
      "unassigned",
    );
  });

  it("narrows by status within the view", () => {
    const sql = sqlFor(scope({ view: "all", status: ["draft"] }));
    expect(sql).toContain('"design_tickets"."status" in');
    expect(paramsFor(scope({ view: "all", status: ["draft"] }))).toContain(
      "draft",
    );
  });

  it("searches title, brief, brand and requester", () => {
    const sql = sqlFor(scope({ q: "logo" }));
    expect(sql).toContain('"design_tickets"."title" ilike');
    expect(sql).toContain('"design_tickets"."brief" ilike');
    expect(sql).toContain('"brands"."name" ilike');
    expect(sql).toContain('"requester"."email" ilike');
  });

  /* `%` and `_` are ilike wildcards: unescaped, a search for "50%" matched
     every row in the table. */
  it("escapes wildcards in the search term", () => {
    expect(paramsFor(scope({ q: "50%" }))).toContain("%50\\%%");
    expect(paramsFor(scope({ q: "a_b" }))).toContain("%a\\_b%");
  });

  it("adds a ticket-number comparison only for a searchable number", () => {
    expect(sqlFor(scope({ q: "DT-124" }))).toContain(
      '"design_tickets"."ticket_number" =',
    );
    expect(sqlFor(scope({ q: "+2348012345678" }))).not.toContain(
      '"design_tickets"."ticket_number" =',
    );
  });

  it("adds nothing for an empty search", () => {
    expect(sqlFor(scope({ q: "   " }))).toBe(sqlFor(scope()));
  });
});

describe("the date window is applied at both ends", () => {
  const lower = '"design_tickets"."created_at" >=';
  const upper = '"design_tickets"."created_at" <';

  it("applies both bounds of a preset range", () => {
    const sql = sqlFor(scope({ range: "7d" }));
    expect(sql).toContain(lower);
    expect(sql).toContain(upper);
  });

  it("applies both bounds of a full custom range", () => {
    const sql = sqlFor(
      scope({ range: "custom", from: "2026-07-19", to: "2026-07-25" }),
    );
    expect(sql).toContain(lower);
    expect(sql).toContain(upper);
  });

  it("applies the lower bound of a start-only range", () => {
    expect(sqlFor(scope({ range: "custom", from: "2026-07-19" }))).toContain(
      lower,
    );
  });

  /* The blocker: resolveWindow returned the upper bound correctly and the
     consumer guarded BOTH pushes on `window.from`, so an end-only range
     dropped its only bound and returned every ticket including today's. */
  it("applies the upper bound of an end-only range", () => {
    const sql = sqlFor(scope({ range: "custom", to: "2026-07-25" }));
    expect(sql).toContain(upper);
    expect(sql).not.toContain(lower);
  });

  /* `all` must bound NOTHING. An upper bound of `now` hides every future due
     date the moment a caller anchors on `due`. */
  it("bounds nothing for the all range", () => {
    for (const on of DATE_ANCHORS) {
      const sql = sqlFor(scope({ view: "all", range: "all", on }));
      expect(sql).toBe("");
    }
  });

  it("anchors on the column the scope names", () => {
    expect(sqlFor(scope({ range: "7d", on: "due" }))).toContain(
      '"design_tickets"."due_date" >=',
    );
    expect(sqlFor(scope({ range: "7d", on: "approved" }))).toContain(
      '"design_tickets"."approved_at" >=',
    );
  });
});

describe("the workload header and the overdue tab agree", () => {
  /* The blocker: overdue was counted INSIDE the active narrowing, so a
     designer's revision_requested ticket past its due date showed in the
     Overdue tab while the header above it reported none. Compiling the two
     aggregates is what makes re-nesting them visible. */
  const counts = workloadCounts(NOW);
  const compile = (frag: SQL) => dialect.sqlToQuery(frag);

  it("counts overdue work the active list does not contain", () => {
    const overdue = compile(counts.overdue);
    // revision_requested and submitted are overdue-eligible and NOT active.
    expect(overdue.params).toContain("draft");
    expect(overdue.params).toContain("delivered");
    expect(overdue.params).not.toContain("revision_requested");
    expect(overdue.sql).toContain('"design_tickets"."due_date" <');
  });

  it("does not nest the overdue filter inside the active status list", () => {
    const overdue = compile(counts.overdue);
    // If overdue were computed within active, its params would carry active's
    // allow-list and it would be a status IN, not a NOT IN.
    expect(overdue.sql).toContain('"design_tickets"."status" not in');
    expect(overdue.sql).not.toContain('"design_tickets"."status" in (');
  });

  it("counts active work by the same allow-list the list uses", () => {
    const active = compile(counts.active);
    expect(active.sql).toContain('"design_tickets"."status" in');
    for (const status of VIEW_PREDICATES.active.statusIn ?? []) {
      expect(active.params).toContain(status);
    }
  });
});

/**
 * `orderFor` was module-private with `db` mocked, so nothing reached it:
 * flipping asc/desc listed the LEAST overdue ticket first and left the suite
 * green, and deleting the `id` tiebreak — whose own comment says removing it
 * lets paging show a ticket twice and never show another — did too.
 */
describe("ordering", () => {
  const orderSql = (s: AdminScope) =>
    orderFor(s).map((c) => dialect.sqlToQuery(c).sql);

  it("puts the most overdue ticket first, oldest due date ascending", () => {
    const [primary] = orderSql(scope({ view: "overdue" }));
    expect(primary).toContain('"design_tickets"."due_date"');
    expect(primary).toMatch(/asc$/);
    expect(primary).not.toMatch(/desc$/);
  });

  it("puts urgent work first in the working queue", () => {
    const [primary] = orderSql(scope({ view: "open" }));
    expect(primary).toContain('"design_tickets"."priority"');
    // The enum is declared low < normal < high < urgent, so desc is urgent-first.
    expect(primary).toMatch(/desc$/);
  });

  it("honours an explicit sort direction on a plain field", () => {
    expect(orderSql(scope({ sort: "created:asc" }))[0]).toMatch(/asc$/);
    expect(orderSql(scope({ sort: "created:desc" }))[0]).toMatch(/desc$/);
  });

  /* Without a total order, rows tying on the sort column come back in whatever
     order the plan produced, so page 2 can repeat a row and drop another. */
  it("always ends in a unique tiebreak", () => {
    for (const view of ADMIN_TICKET_VIEWS) {
      const clauses = orderSql(scope({ view }));
      expect(clauses.at(-1)).toBe('"design_tickets"."id" asc');
    }
  });

  it("falls back to a secondary sort when the primary is not createdAt", () => {
    const clauses = orderSql(scope({ view: "overdue" }));
    expect(clauses).toHaveLength(3);
    expect(clauses[1]).toContain('"design_tickets"."created_at"');
  });
});

/* The pager/offset agreement is asserted where it can actually break — against
   the rendered pager, in app/admin/tickets/page.test.tsx. Restating
   `DEFAULT_PAGE_SIZE === PAGE_SIZE` here only re-read one line of source. */

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
